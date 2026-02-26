import { BrowserWindow, app, dialog, ipcMain, screen, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpegPathWithMeta } from './ffmpeg-path';
import { writeSelectedOutputs } from './output/writers';
import { ProcessorClient } from './processor-client';
import type { AppLogEntry, AppSettings, ArchiveBatch, OutputOptions, ProcessingJob, QueueItem, WhisperModel } from './types';
import { resolveWhisperModelDirectoryWithMeta, resolveWhisperPathWithMeta } from './whisper-path';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const archivePath = path.join(app.getPath('userData'), 'archive.json');
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
  overwritePolicy: 'overwrite',
  writeRunLog: false
};

const queue: QueueItem[] = [];
const archiveBatches: ArchiveBatch[] = [];
const ffmpegRuntime = resolveFfmpegPathWithMeta();
const whisperRuntime = resolveWhisperPathWithMeta();
const whisperModelRuntime = resolveWhisperModelDirectoryWithMeta();

const processor = new ProcessorClient(ffmpegRuntime.resolvedPath, whisperRuntime.resolvedPath, whisperModelRuntime.resolvedPath);
let activeJobId: string | null = null;
let queuePaused = false;
const appLogs: AppLogEntry[] = [];

type RunSummary = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  total: number;
  done: number;
  failed: number;
  canceled: number;
  writeRunLog: boolean;
  logOutputDirectory: string;
  fatalError?: string;
};

let activeRun: RunSummary | null = null;

const isWhisperModel = (value: unknown): value is WhisperModel => ['tiny', 'base', 'small'].includes(String(value));

const sanitizeOutputOptions = (value: unknown): OutputOptions => {
  const options = value && typeof value === 'object' ? (value as Partial<OutputOptions>) : {};
  return {
    txt: typeof options.txt === 'boolean' ? options.txt : defaultSettings.outputOptions.txt,
    timecodedTxt:
      typeof options.timecodedTxt === 'boolean' ? options.timecodedTxt : defaultSettings.outputOptions.timecodedTxt,
    srt: typeof options.srt === 'boolean' ? options.srt : defaultSettings.outputOptions.srt,
    vtt: typeof options.vtt === 'boolean' ? options.vtt : defaultSettings.outputOptions.vtt,
    json: typeof options.json === 'boolean' ? options.json : defaultSettings.outputOptions.json
  };
};

const sanitizeSettings = (value: unknown): AppSettings => {
  const candidate = value && typeof value === 'object' ? (value as Partial<AppSettings>) : {};
  const outputDirectory =
    typeof candidate.outputDirectory === 'string' && candidate.outputDirectory.trim().length > 0
      ? path.resolve(candidate.outputDirectory)
      : defaultSettings.outputDirectory;

  return {
    outputDirectory,
    language:
      typeof candidate.language === 'string' && candidate.language.trim().length > 0
        ? candidate.language.trim()
        : defaultSettings.language,
    model: isWhisperModel(candidate.model) ? candidate.model : defaultSettings.model,
    outputOptions: sanitizeOutputOptions(candidate.outputOptions),
    overwritePolicy: candidate.overwritePolicy === 'skip-existing' ? 'skip-existing' : defaultSettings.overwritePolicy,
    writeRunLog: typeof candidate.writeRunLog === 'boolean' ? candidate.writeRunLog : defaultSettings.writeRunLog
  };
};

const sanitizeArchiveBatches = (value: unknown): ArchiveBatch[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const batches: ArchiveBatch[] = [];
  for (const batch of value) {
    if (!batch || typeof batch !== 'object') {
      continue;
    }

    const candidate = batch as Partial<ArchiveBatch>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.startedAt !== 'string' ||
      typeof candidate.archivedAt !== 'string' ||
      !Array.isArray(candidate.items)
    ) {
      continue;
    }

    batches.push({
      id: candidate.id,
      startedAt: candidate.startedAt,
      archivedAt: candidate.archivedAt,
      items: candidate.items
    });
  }

  return batches;
};

const appendLog = (entry: Omit<AppLogEntry, 'timestamp'>) => {
  const withTimestamp: AppLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };

  appLogs.push(withTimestamp);
  if (appLogs.length > 500) {
    appLogs.splice(0, appLogs.length - 500);
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app-log:entry', withTimestamp);
  }
};

const MIN_CONTENT_HEIGHT = 760;
const WINDOW_HEIGHT_PADDING = 56;

const ensureWindowCanFitContent = (window: BrowserWindow, requestedContentHeight: number) => {
  const display = screen.getDisplayMatching(window.getBounds());
  const maxWindowHeight = display.workAreaSize.height;
  const [currentWindowWidth, currentWindowHeight] = window.getSize();
  const desiredWindowHeight = Math.min(
    Math.max(MIN_CONTENT_HEIGHT, Math.ceil(requestedContentHeight) + WINDOW_HEIGHT_PADDING),
    maxWindowHeight
  );

  if (desiredWindowHeight <= currentWindowHeight) {
    return;
  }

  window.setSize(currentWindowWidth, desiredWindowHeight);
};

const withSafePath = async (inputPath: string): Promise<string> => path.resolve(inputPath);

const readSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeSettings(parsed);
  } catch {
    return { ...defaultSettings };
  }
};

const readArchiveBatches = async (): Promise<ArchiveBatch[]> => {
  try {
    const raw = await fs.readFile(archivePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeArchiveBatches(parsed);
  } catch {
    return [];
  }
};

const persistArchiveBatches = async (): Promise<void> => {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, JSON.stringify(archiveBatches, null, 2), 'utf8');
};

const emitQueueState = () => {
  const snapshot = {
    items: [...queue],
    archiveBatches: [...archiveBatches],
    activeJobId,
    hasRunningJob: Boolean(activeJobId),
    isPaused: queuePaused
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('queue:state', snapshot);
  }
};

const persistSettings = async (next: Partial<AppSettings>) => {
  const current = await readSettings();
  const merged = sanitizeSettings({
    ...current,
    ...next,
    outputOptions: {
      ...current.outputOptions,
      ...(next.outputOptions ?? {})
    }
  });

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
};

const writeRunLogFile = async (summary: RunSummary): Promise<void> => {
  if (!summary.writeRunLog) {
    return;
  }

  const lines: string[] = [];
  lines.push(`Run ID: ${summary.runId}`);
  lines.push(`Started: ${summary.startedAt}`);
  lines.push(`Completed: ${summary.completedAt ?? new Date().toISOString()}`);
  lines.push(`Total: ${summary.total}`);
  lines.push(`Completed: ${summary.done}`);
  lines.push(`Failed: ${summary.failed}`);
  lines.push(`Canceled: ${summary.canceled}`);
  if (summary.fatalError) {
    lines.push(`Fatal Error: ${summary.fatalError}`);
  }
  lines.push('');
  lines.push('Entries:');

  for (const entry of appLogs) {
    const contextParts = [`event=${entry.event}`];
    if (entry.jobId) {
      contextParts.push(`jobId=${entry.jobId}`);
    }
    if (entry.filePath) {
      contextParts.push(`file=${entry.filePath}`);
    }

    lines.push(`${entry.timestamp} [${entry.level}] ${contextParts.join(' ')} ${entry.message}`);
  }

  const logPath = path.join(summary.logOutputDirectory, 'transcribe_log.txt');
  await fs.mkdir(summary.logOutputDirectory, { recursive: true });
  await fs.writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  appendLog({
    level: 'info',
    event: 'run.log_written',
    message: `Wrote transcribe_log.txt to ${summary.logOutputDirectory}`
  });
};

const finalizeRunIfComplete = async () => {
  if (!activeRun || activeJobId || findNextPending()) {
    return;
  }

  activeRun.completedAt = new Date().toISOString();
  const summary = activeRun;
  appendLog({
    level: summary.fatalError ? 'error' : 'info',
    event: 'run.complete',
    message: `Run complete. total=${summary.total} done=${summary.done} failed=${summary.failed} canceled=${summary.canceled}${
      summary.fatalError ? ` fatal=${summary.fatalError}` : ''
    }`
  });

  try {
    await writeRunLogFile(summary);
  } catch (error) {
    appendLog({
      level: 'error',
      event: 'run.log_write_failed',
      message: `Failed to write transcribe_log.txt: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  activeRun = null;
};


const failPendingJobsForFatalError = (fatalError: string) => {
  for (const item of queue) {
    if (item.status !== 'pending') {
      continue;
    }

    item.status = 'failed';
    item.progress = 0;
    item.error = fatalError;
    if (activeRun) {
      activeRun.failed += 1;
    }
    appendLog({
      level: 'error',
      event: 'job.failed_fatal_init',
      jobId: item.id,
      filePath: item.sourcePath,
      message: `Failed ${path.basename(item.sourcePath)} due to fatal initialization error: ${fatalError}`
    });
  }
};

const runtimeValidationByModel = new Map<ProcessingJob['model'], string | null>();
let runtimeValidationErrorShown = false;

const formatRuntimeError = (model: ProcessingJob['model'], reason: string): string => [
  'Processing runtime is unavailable. Queue is paused until runtime files are installed.',
  `Resolution mode: ${ffmpegRuntime.mode === 'packaged' ? 'packaged app resources' : 'development paths'}.`,
  `FFmpeg path: ${ffmpegRuntime.resolvedPath}`,
  `whisper.cpp path: ${whisperRuntime.resolvedPath}`,
  `Model directory: ${whisperModelRuntime.resolvedPath}`,
  `Model requested: ${model}`,
  `Details: ${reason}`
].join(' ');

const validateRuntimeForModel = async (model: ProcessingJob['model']): Promise<string | null> => {
  if (runtimeValidationByModel.has(model)) {
    return runtimeValidationByModel.get(model) ?? null;
  }

  try {
    await processor.validateRuntime(model);
    runtimeValidationByModel.set(model, null);
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const runtimeError = formatRuntimeError(model, reason);
    runtimeValidationByModel.set(model, runtimeError);
    return runtimeError;
  }
};

void (async () => {
  const loadedArchiveBatches = await readArchiveBatches();
  archiveBatches.length = 0;
  archiveBatches.push(...loadedArchiveBatches);

  const runtimeError = await validateRuntimeForModel(defaultSettings.model);
  if (runtimeError) {
    appendLog({ level: 'error', event: 'runtime.invalid', message: runtimeError });
  } else {
    appendLog({
      level: 'info',
      event: 'runtime.ready',
      message: `Runtime check passed (${ffmpegRuntime.mode} mode): FFmpeg, whisper.cpp, and model files were detected.`
    });
  }
})();

const queueItemToJob = (item: QueueItem): ProcessingJob => ({
  id: item.id,
  filePath: item.sourcePath,
  outputDirectory: item.outputDirectory,
  language: item.language,
  model: item.model,
  outputOptions: item.outputOptions
});

const findNextPending = () => queue.find((item) => item.status === 'pending');

const processNextPending = async () => {
  if (activeJobId || queuePaused) {
    return;
  }

  const next = findNextPending();
  if (!next) {
    emitQueueState();
    await finalizeRunIfComplete();
    return;
  }

  activeJobId = next.id;
  appendLog({
    level: 'info',
    event: 'job.started',
    jobId: next.id,
    filePath: next.sourcePath,
    message: `Started processing ${path.basename(next.sourcePath)}.`
  });
  const runtimeError = await validateRuntimeForModel(next.model);
  if (runtimeError) {
    activeJobId = null;
    queuePaused = true;
    if (activeRun) {
      activeRun.fatalError = runtimeError;
    }

    failPendingJobsForFatalError(runtimeError);

    if (!runtimeValidationErrorShown) {
      appendLog({
        level: 'error',
        event: 'runtime.invalid',
        jobId: next.id,
        filePath: next.sourcePath,
        message: runtimeError
      });
      runtimeValidationErrorShown = true;
    }

    emitQueueState();
    await finalizeRunIfComplete();
    return;
  }

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
    if (activeRun) {
      activeRun.done += 1;
    }

    appendLog({
      level: 'info',
      event: 'job.completed',
      jobId: item.id,
      filePath: item.sourcePath,
      message: `Completed ${path.basename(item.sourcePath)}. Wrote ${outputFiles.length} output file(s).`
    });
  } catch (error) {
    item.status = 'failed';
    item.progress = 0;
    item.error = error instanceof Error ? error.message : String(error);
    if (activeRun) {
      activeRun.failed += 1;
    }
    appendLog({
      level: 'error',
      event: 'job.output_failed',
      jobId: item.id,
      filePath: item.sourcePath,
      message: `Failed writing outputs for ${path.basename(item.sourcePath)}: ${item.error}`
    });
  }

  activeJobId = null;
  emitQueueState();
  void processNextPending();
});

processor.on('error', (payload) => {
  if (payload.jobId === 'worker') {
    appendLog({ level: 'error', event: 'worker.error', message: `Worker error: ${payload.error}` });
    return;
  }

  const item = queue.find((entry) => entry.id === payload.jobId);
  if (!item) {
    return;
  }

  item.status = payload.canceled ? 'canceled' : 'failed';
  item.error = payload.error;
  item.progress = payload.canceled ? item.progress : 0;
  if (activeRun) {
    if (payload.canceled) {
      activeRun.canceled += 1;
    } else {
      activeRun.failed += 1;
    }
  }

  appendLog({
    level: payload.canceled ? 'info' : 'error',
    event: payload.canceled ? 'job.canceled' : 'job.failed',
    jobId: item.id,
    filePath: item.sourcePath,
    message: payload.canceled ? `Canceled ${path.basename(item.sourcePath)}.` : `Failed ${path.basename(item.sourcePath)}: ${payload.error}`
  });

  if (activeJobId === payload.jobId) {
    activeJobId = null;
  }

  emitQueueState();
  void processNextPending();
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

ipcMain.handle('settings:pickOutputDirectory', async (_event, defaultPath?: string) => {
  const result = await dialog.showOpenDialog({
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0] ?? null;
});

ipcMain.handle('app-log:list', () => [...appLogs]);

ipcMain.handle('window:fit-content', (event, requestedContentHeight: number) => {
  if (typeof requestedContentHeight !== 'number' || !Number.isFinite(requestedContentHeight)) {
    return { ok: false as const };
  }

  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { ok: false as const };
  }

  ensureWindowCanFitContent(window, requestedContentHeight);
  return { ok: true as const };
});

ipcMain.handle('queue:list', () => ({
  items: [...queue],
  archiveBatches: [...archiveBatches],
  activeJobId,
  hasRunningJob: Boolean(activeJobId),
  isPaused: queuePaused
}));

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
  appendLog({ level: 'info', event: 'queue.added', message: `Queued ${sourcePaths.length} file(s).` });
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

ipcMain.handle('queue:archiveCompleted', () => {
  const completedItems = queue.filter((item) => ['done', 'failed', 'canceled'].includes(item.status));
  const remainingItems = queue.filter((item) => !['done', 'failed', 'canceled'].includes(item.status));

  const byBatch = new Map<string, QueueItem[]>();
  for (const item of completedItems) {
    const batchId = item.batchId ?? `manual_${item.id}`;
    const existing = byBatch.get(batchId);
    if (existing) {
      existing.push(item);
    } else {
      byBatch.set(batchId, [item]);
    }
  }

  const archivedAt = new Date().toISOString();
  for (const [batchId, items] of byBatch.entries()) {
    archiveBatches.unshift({
      id: batchId,
      startedAt: items[0]?.batchStartedAt ?? archivedAt,
      archivedAt,
      items: [...items]
    });
  }

  queue.length = 0;
  queue.push(...remainingItems);
  void persistArchiveBatches().catch((error) => {
    appendLog({
      level: 'error',
      event: 'queue.archive_persist_failed',
      message: `Failed to persist archive batches: ${error instanceof Error ? error.message : String(error)}`
    });
  });
  emitQueueState();

  if (completedItems.length > 0) {
    appendLog({
      level: 'info',
      event: 'queue.archived',
      message: `Archived ${completedItems.length} completed queue item(s) across ${byBatch.size} batch(es).`
    });
  }

  return { ok: true as const };
});

ipcMain.handle('queue:start', async () => {
  queuePaused = false;
  const settings = await readSettings();

  const runId = randomUUID();
  const runStartedAt = new Date().toISOString();

  activeRun = {
    runId,
    startedAt: runStartedAt,
    total: queue.filter((item) => item.status === 'pending').length,
    done: 0,
    failed: 0,
    canceled: 0,
    writeRunLog: Boolean(settings.writeRunLog),
    logOutputDirectory: settings.outputDirectory
  };

  for (const item of queue) {
    if (item.status === 'pending') {
      item.batchId = runId;
      item.batchStartedAt = runStartedAt;
    }
  }

  appendLog({ level: 'info', event: 'queue.started', message: 'Queue start requested.' });

  const firstPending = findNextPending();
  if (firstPending) {
    const runtimeError = await validateRuntimeForModel(firstPending.model);
    if (runtimeError) {
      if (activeRun) {
        activeRun.fatalError = runtimeError;
      }
      failPendingJobsForFatalError(runtimeError);
      appendLog({
        level: 'error',
        event: 'runtime.invalid',
        jobId: firstPending.id,
        filePath: firstPending.sourcePath,
        message: runtimeError
      });
      emitQueueState();
      await finalizeRunIfComplete();
      return { ok: false as const, error: runtimeError };
    }
  }

  void processNextPending();
  emitQueueState();
  return { ok: true as const };
});

ipcMain.handle('queue:pause', () => {
  if (!queuePaused) {
    queuePaused = true;
    appendLog({ level: 'info', event: 'queue.paused', message: 'Queue paused. Current job will finish before processing stops.' });
    emitQueueState();
  }

  return { ok: true as const };
});

ipcMain.handle('queue:resume', () => {
  if (queuePaused) {
    queuePaused = false;
    appendLog({ level: 'info', event: 'queue.resumed', message: 'Queue resumed.' });
    void processNextPending();
    emitQueueState();
  }

  return { ok: true as const };
});

ipcMain.handle('queue:cancelCurrent', () => {
  if (!activeJobId) {
    return { ok: true as const };
  }

  appendLog({ level: 'info', event: 'job.cancel_requested', jobId: activeJobId, message: `Cancel requested for job ${activeJobId}.` });
  processor.cancel(activeJobId);
  return { ok: true as const };
});

ipcMain.handle('queue:openOutputFolder', async (_event, id: string) => {
  const fromQueue = queue.find((entry) => entry.id === id);
  const fromArchive = archiveBatches
    .flatMap((batch) => batch.items)
    .find((entry) => entry.id === id);

  const item = fromQueue ?? fromArchive;
  if (!item || item.status !== 'done') {
    return { ok: false as const };
  }

  await shell.openPath(item.outputDirectory);
  return { ok: true as const };
});
