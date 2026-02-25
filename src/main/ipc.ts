import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpegPath } from './ffmpeg-path';
import { ProcessorClient } from './processor-client';
import { writeSelectedOutputs } from './output/writers';
import type { AppSettings, OutputOptions, ProcessingJob, QueueItem } from './types';

type LogLevel = 'info' | 'error';

type AppLogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaultSettings: AppSettings = {
  outputDirectory: app.getPath('documents'),
  language: 'en',
  model: 'base',
  outputOptions: {
    txt: true,
    timecodedTxt: true,
    srt: true,
    vtt: false,
    json: true
  },
  overwritePolicy: 'overwrite'
};

const queue: QueueItem[] = [];
const processor = new ProcessorClient(resolveFfmpegPath());
let activeJobId: string | null = null;
const appLogs: AppLogEntry[] = [];

const appendLog = (message: string, level: LogLevel = 'info') => {
  const entry: AppLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };

  appLogs.push(entry);
  if (appLogs.length > 200) {
    appLogs.splice(0, appLogs.length - 200);
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app-log:entry', entry);
  }
};

const withSafePath = async (inputPath: string): Promise<string> => path.resolve(inputPath);

const readSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      outputOptions: {
        ...defaultSettings.outputOptions,
        ...(parsed.outputOptions ?? {})
      },
      overwritePolicy: parsed.overwritePolicy ?? defaultSettings.overwritePolicy
    };
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
  appendLog(`Started processing ${path.basename(next.sourcePath)} (${next.id}).`);
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
  const settings = await readSettings();

  try {
    const outputFiles = await writeSelectedOutputs({
      outputDirectory: outDir,
      baseName,
      outputOptions: item.outputOptions,
      segments: payload.segments,
      transcriptText: payload.transcriptText,
      overwritePolicy: settings.overwritePolicy ?? 'overwrite'
    });

    item.outputFiles = outputFiles;
    item.status = 'done';
    item.progress = 100;
    item.error = undefined;

    appendLog(`Completed ${path.basename(item.sourcePath)}. Wrote ${outputFiles.length} output file(s).`);
  } catch (error) {
    item.status = 'failed';
    item.progress = 0;
    item.error = error instanceof Error ? error.message : String(error);
    appendLog(`Failed writing outputs for ${path.basename(item.sourcePath)}: ${item.error}`, 'error');
  }

  activeJobId = null;
  emitQueueState();
  processNextPending();
});

processor.on('error', (payload) => {
  if (payload.jobId === 'worker') {
    appendLog(`Worker error: ${payload.error}`, 'error');
    return;
  }

  const item = queue.find((entry) => entry.id === payload.jobId);
  if (!item) {
    return;
  }

  item.status = payload.canceled ? 'canceled' : 'failed';
  item.error = payload.error;
  item.progress = payload.canceled ? item.progress : 0;
  appendLog(
    payload.canceled
      ? `Canceled ${path.basename(item.sourcePath)}.`
      : `Failed ${path.basename(item.sourcePath)}: ${payload.error}`,
    payload.canceled ? 'info' : 'error'
  );

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
ipcMain.handle('app-log:list', () => [...appLogs]);

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
  appendLog(`Queued ${sourcePaths.length} file(s).`);
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
  const removedCount = queue.filter((item) => ['done', 'failed', 'canceled'].includes(item.status)).length;
  const next = queue.filter((item) => !['done', 'failed', 'canceled'].includes(item.status));
  queue.length = 0;
  queue.push(...next);
  emitQueueState();
  if (removedCount > 0) {
    appendLog(`Cleared ${removedCount} completed queue item(s).`);
  }
  return { ok: true as const };
});

ipcMain.handle('queue:start', () => {
  appendLog('Queue start requested.');
  processNextPending();
  return { ok: true as const };
});

ipcMain.handle('queue:cancelCurrent', () => {
  if (!activeJobId) {
    return { ok: true as const };
  }

  appendLog(`Cancel requested for job ${activeJobId}.`);
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
