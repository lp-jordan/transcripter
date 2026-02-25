import { app, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

type QueueItem = {
  id: string;
  filePath: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
};

type AppSettings = {
  outputDirectory: string;
  language: string;
};

const queue: QueueItem[] = [];
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaultSettings: AppSettings = {
  outputDirectory: app.getPath('documents'),
  language: 'en'
};

const withSafePath = async (inputPath: string): Promise<string> => {
  const absolute = path.resolve(inputPath);
  return absolute;
};

const readSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaultSettings;
  }
};

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

ipcMain.handle('queue:add', async (_event, filePath: string) => {
  const item: QueueItem = {
    id: randomUUID(),
    filePath,
    status: 'pending'
  };
  queue.push(item);
  return item;
});

ipcMain.handle('queue:list', () => {
  return [...queue];
});

ipcMain.handle('queue:remove', (_event, id: string) => {
  const index = queue.findIndex((item) => item.id === id);
  if (index >= 0) {
    queue.splice(index, 1);
  }
  return { ok: true as const };
});

ipcMain.handle('settings:get', async () => {
  return readSettings();
});

ipcMain.handle('settings:set', async (_event, next: Partial<AppSettings>) => {
  const current = await readSettings();
  const merged: AppSettings = { ...current, ...next };
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
});
