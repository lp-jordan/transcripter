import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessorClient } from './processor-client';
import type { AppSettings, OutputOptions, ProcessingJob, QueueItem } from './types';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaultSettings: AppSettings = {
  outputDirectory: app.getPath('documents'),
  language: 'en',
  model: 'base',
  outputOptions: {
    txt: true,
    srt: true,
    json: true
  }
};

const queue: QueueItem[] = [];
const processor = new ProcessorClient();
let activeJobId: string | null = null;

const withSafePath = async (inputPath: string): Promise<string> => path.resolve(inputPath);

const readSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaultSettings;
  }
};

const emitQueueState = () => {
  const snapshot = {
    items: [...queue],
    activeJobId,
    hasRunningJob: Boolean(activeJobId)
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('queue:state', snapshot);
  }
};

const persistSettings = async (next: Partial<AppSettings>) => {
  const current = await readSettings();
  const merged: AppSettings = {
    ...current,
    ...next,
    outputOptions: {
      ...current.outputOptions,
      ...(next.outputOptions ?? {})
    }
  };

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
};

const queueItemToJob = (item: QueueItem): ProcessingJob => ({
  id: item.id,
  filePath: item.sourcePath,
  outputDirectory: item.outputDirectory,
  language: item.language,
  model: item.model,
  outputOptions: item.outputOptions
});

const findNextPending = () => queue.find((item) => item.status === 'pending');

const processNextPending = () => {
  if (activeJobId) {
    return;
  }

  const next = findNextPending();
  if (!next) {
    emitQueueState();
    return;
  }

  activeJobId = next.id;
  processor.run(queueItemToJob(next));
  emitQueueState();
};

processor.on('progress', (payload) => {
  const item = queue.find((entry) => entry.id === payload.jobId);
  if (!item) {
    return;
  }

  item.status = payload.stage;
  item.progress = payload.progress;
  emitQueueState();
});

processor.on('complete', async (payload) => {
  const item = queue.find((entry) => entry.id === payload.jobId);
  if (!item) {
    return;
  }

  item.status = 'writing_outputs';
  item.progress = 0;
  emitQueueState();

  const outDir = item.outputDirectory;
  const baseName = path.parse(item.sourcePath).name;
  const outputFiles: string[] = [];

  await fs.mkdir(outDir, { recursive: true });

  if (item.outputOptions.txt) {
    const txtPath = path.join(outDir, `${baseName}.txt`);
    await fs.writeFile(txtPath, `${payload.transcriptText.trim()}\n`, 'utf8');
    outputFiles.push(txtPath);
  }

  if (item.outputOptions.json) {
    const jsonPath = path.join(outDir, `${baseName}.json`);
    await fs.writeFile(
      jsonPath,
      `${JSON.stringify({ text: payload.transcriptText, segments: payload.segments }, null, 2)}\n`,
      'utf8'
    );
    outputFiles.push(jsonPath);
  }

  if (item.outputOptions.srt) {
    const srtPath = path.join(outDir, `${baseName}.srt`);
    const toTime = (seconds: number) => {
      const millis = Math.max(0, Math.floor(seconds * 1000));
      const hours = Math.floor(millis / 3_600_000);
      const minutes = Math.floor((millis % 3_600_000) / 60_000);
      const secs = Math.floor((millis % 60_000) / 1000);
      const ms = millis % 1000;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const body = payload.segments
      .map((segment, index) => `${index + 1}\n${toTime(segment.start)} --> ${toTime(segment.end)}\n${segment.text}\n`)
      .join('\n');
    await fs.writeFile(srtPath, body, 'utf8');
    outputFiles.push(srtPath);
  }

  item.outputFiles = outputFiles;
  item.status = 'done';
  item.progress = 100;
  item.error = undefined;

  activeJobId = null;
  emitQueueState();
  processNextPending();
});

processor.on('error', (payload) => {
  if (payload.jobId === 'worker') {
    return;
  }

  const item = queue.find((entry) => entry.id === payload.jobId);
  if (!item) {
    return;
  }

  item.status = payload.canceled ? 'canceled' : 'failed';
  item.error = payload.error;
  item.progress = payload.canceled ? item.progress : 0;

  if (activeJobId === payload.jobId) {
    activeJobId = null;
  }

  emitQueueState();
  processNextPending();
});

app.on('before-quit', () => {
  processor.dispose();
});

ipcMain.handle('file:readText', async (_event, filePath: string) => {
  const safePath = await withSafePath(filePath);
  return fs.readFile(safePath, 'utf8');
});

ipcMain.handle('file:writeText', async (_event, filePath: string, content: string) => {
  const safePath = await withSafePath(filePath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, content, 'utf8');
  return { ok: true as const };
});

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', async (_event, next: Partial<AppSettings>) => persistSettings(next));

ipcMain.handle('queue:list', () => ({ items: [...queue], activeJobId, hasRunningJob: Boolean(activeJobId) }));

ipcMain.handle('queue:add', async (_event, sourcePaths: string[]) => {
  const settings = await readSettings();

  for (const sourcePath of sourcePaths) {
    queue.push({
      id: randomUUID(),
      sourcePath,
      outputDirectory: settings.outputDirectory,
      outputOptions: settings.outputOptions,
      model: settings.model,
      language: settings.language,
      status: 'pending',
      progress: 0
    });
  }

  emitQueueState();
  return { ok: true as const };
});

ipcMain.handle('queue:pickFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

ipcMain.handle('queue:removeSelected', (_event, ids: string[]) => {
  const next = queue.filter((item) => !ids.includes(item.id) && item.id !== activeJobId);
  queue.length = 0;
  queue.push(...next);
  emitQueueState();
  return { ok: true as const };
});

ipcMain.handle('queue:clearCompleted', () => {
  const next = queue.filter((item) => !['done', 'failed', 'canceled'].includes(item.status));
  queue.length = 0;
  queue.push(...next);
  emitQueueState();
  return { ok: true as const };
});

ipcMain.handle('queue:start', () => {
  processNextPending();
  return { ok: true as const };
});

ipcMain.handle('queue:cancelCurrent', () => {
  if (!activeJobId) {
    return { ok: true as const };
  }

  processor.cancel(activeJobId);
  return { ok: true as const };
});

ipcMain.handle('queue:openOutputFolder', async (_event, id: string) => {
  const item = queue.find((entry) => entry.id === id);
  if (!item || item.status !== 'done') {
    return { ok: false as const };
  }

  await shell.openPath(item.outputDirectory);
  return { ok: true as const };
});
