import { contextBridge, ipcRenderer } from 'electron';

type QueueItem = {
  id: string;
  filePath: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
};

type AppSettings = {
  outputDirectory: string;
  language: string;
};

const api = {
  file: {
    readText: (filePath: string) => ipcRenderer.invoke('file:readText', filePath),
    writeText: (filePath: string, content: string) => ipcRenderer.invoke('file:writeText', filePath, content)
  },
  queue: {
    add: (filePath: string): Promise<QueueItem> => ipcRenderer.invoke('queue:add', filePath),
    list: (): Promise<QueueItem[]> => ipcRenderer.invoke('queue:list'),
    remove: (id: string) => ipcRenderer.invoke('queue:remove', id)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (next: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', next)
  }
};

contextBridge.exposeInMainWorld('transcripter', api);

export type TranscripterApi = typeof api;
