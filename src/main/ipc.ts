import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProcessorClient } from './processor-client';
import type { OutputOptions, ProcessingJob, QueueItem, Segment, WhisperModel } from './types';

type AppSettings = {
  outputDirectory: string;
  language: string;
  model: WhisperModel;
  outputOptions: OutputOptions;
};

const queue = new Map<string, QueueItem>();
const queueOrder: string[] = [];
const activeJobs = new Set<string>();

const defaults: AppSettings = {
  outputDirectory: path.join(app.getPath('documents'), 'transcripter-output'),
  language: '',
  model: 'small',
  outputOptions: {
    txt: true,
    srt: true,
    json: true
  }
};

let settings: AppSettings = { ...defaults };
const processor = new ProcessorClient();

const emitQueueEvent = (type: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(`queue:${type}`, payload);
  }
};

const toSrtTimestamp = (totalSeconds: number): string => {
  const ms = Math.round(totalSeconds * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
};

const writeOutputs = async (job: ProcessingJob, text: string, segments: Segment[]): Promise<string[]> => {
  await fs.mkdir(job.outputDirectory, { recursive: true });

  const baseName = path.parse(job.filePath).name;
  const outputs: string[] = [];

  if (job.outputOptions.txt) {
    const txtPath = path.join(job.outputDirectory, `${baseName}.txt`);
    await fs.writeFile(txtPath, text, 'utf8');
    outputs.push(txtPath);
  }

  if (job.outputOptions.json) {
    const jsonPath = path.join(job.outputDirectory, `${baseName}.segments.json`);
    await fs.writeFile(jsonPath, JSON.stringify({ segments }, null, 2), 'utf8');
    outputs.push(jsonPath);
  }

  if (job.outputOptions.srt) {
    const srtPath = path.join(job.outputDirectory, `${baseName}.srt`);
    const srtBody = segments
      .map((segment, index) => {
        const line = [
          `${index + 1}`,
          `${toSrtTimestamp(segment.start)} --> ${toSrtTimestamp(segment.end)}`,
          segment.text,
          ''
        ];

        return line.join('\n');
      })
      .join('\n');
    await fs.writeFile(srtPath, srtBody, 'utf8');
    outputs.push(srtPath);
  }

  return outputs;
};

const updateQueueItem = (jobId: string, patch: Partial<QueueItem>) => {
  const item = queue.get(jobId);
  if (!item) {
    return;
  }

  const updated = {
    ...item,
    ...patch
  };

  queue.set(jobId, updated);
  emitQueueEvent('updated', updated);
};

const makeJobFromQueueItem = (item: QueueItem): ProcessingJob => ({
  id: item.id,
  filePath: item.filePath,
  outputDirectory: settings.outputDirectory,
  language: settings.language || undefined,
  model: settings.model,
  outputOptions: settings.outputOptions
});

const processNextPendingJob = () => {
  const nextItem = queueOrder
    .map((id) => queue.get(id))
    .find((item): item is QueueItem => Boolean(item) && item.status === 'pending' && !activeJobs.has(item.id));

  if (!nextItem) {
    return;
  }

  activeJobs.add(nextItem.id);
  updateQueueItem(nextItem.id, {
    status: 'extracting_audio',
    progress: 0,
    error: undefined
  });

  processor.run(makeJobFromQueueItem(nextItem));
};

processor.on('progress', (event) => {
  updateQueueItem(event.jobId, {
    status: event.stage,
    progress: event.progress
  });
});

processor.on('complete', async (event) => {
  const item = queue.get(event.jobId);
  if (!item) {
    return;
  }

  try {
    updateQueueItem(event.jobId, {
      status: 'writing_outputs',
      progress: 100
    });

    const outputs = await writeOutputs(makeJobFromQueueItem(item), event.transcriptText, event.segments);

    updateQueueItem(event.jobId, {
      status: 'done',
      progress: 100,
      outputFiles: outputs
    });
  } catch (error) {
    updateQueueItem(event.jobId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    activeJobs.delete(event.jobId);
    processNextPendingJob();
  }
});

processor.on('error', (event) => {
  if (event.jobId !== 'worker') {
    activeJobs.delete(event.jobId);

    updateQueueItem(event.jobId, {
      status: event.canceled ? 'canceled' : 'failed',
      error: event.error
    });

    processNextPendingJob();
  }
});


ipcMain.handle('file:readText', async (_event, filePath: string) => fs.readFile(filePath, 'utf8'));

ipcMain.handle('file:writeText', async (_event, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('queue:add', async (_event, filePath: string): Promise<QueueItem> => {
  const item: QueueItem = {
    id: randomUUID(),
    filePath,
    status: 'pending',
    progress: 0
  };

  queue.set(item.id, item);
  queueOrder.push(item.id);
  emitQueueEvent('added', item);
  processNextPendingJob();

  return item;
});

ipcMain.handle('queue:list', () => queueOrder.map((id) => queue.get(id)).filter((item): item is QueueItem => Boolean(item)));

ipcMain.handle('queue:remove', (_event, id: string) => {
  const item = queue.get(id);
  if (!item) {
    return false;
  }

  if (activeJobs.has(id)) {
    processor.cancel(id);
  }

  queue.delete(id);
  const index = queueOrder.indexOf(id);
  if (index >= 0) {
    queueOrder.splice(index, 1);
  }

  emitQueueEvent('removed', { id });
  return true;
});

ipcMain.handle('queue:cancel', (_event, id: string) => {
  if (!queue.has(id) || !activeJobs.has(id)) {
    return false;
  }

  processor.cancel(id);
  return true;
});

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:set', (_event, next: Partial<AppSettings>) => {
  settings = {
    ...settings,
    ...next,
    outputOptions: {
      ...settings.outputOptions,
      ...(next.outputOptions ?? {})
    }
  };

  return settings;
});

app.on('before-quit', () => {
  processor.dispose();
});
