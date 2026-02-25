import { contextBridge, ipcRenderer } from 'electron';

export type QueueItem = {
  id: string;
  filePath: string;
  status:
    | 'pending'
    | 'extracting_audio'
    | 'transcribing'
    | 'writing_outputs'
    | 'done'
    | 'failed'
    | 'canceled';
  progress: number;
  error?: string;
  outputFiles?: string[];
};

export type AppSettings = {
  outputDirectory: string;
  language: string;
  model: 'tiny' | 'base' | 'small';
  outputOptions: {
    txt: boolean;
    srt: boolean;
    json: boolean;
  };
};

const api = {
  file: {
    readText: (filePath: string) => ipcRenderer.invoke('file:readText', filePath),
    writeText: (filePath: string, content: string) => ipcRenderer.invoke('file:writeText', filePath, content)
  },
  queue: {
    add: (filePath: string): Promise<QueueItem> => ipcRenderer.invoke('queue:add', filePath),
    list: (): Promise<QueueItem[]> => ipcRenderer.invoke('queue:list'),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('queue:remove', id),
    cancel: (id: string): Promise<boolean> => ipcRenderer.invoke('queue:cancel', id),
    onUpdated: (listener: (item: QueueItem) => void): (() => void) => {
      const wrapped = (_event: unknown, payload: QueueItem) => listener(payload);
      ipcRenderer.on('queue:updated', wrapped);
      return () => {
        ipcRenderer.removeListener('queue:updated', wrapped);
      };
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (next: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', next)
  }
};

contextBridge.exposeInMainWorld('transcripter', api);

export type TranscripterApi = typeof api;
