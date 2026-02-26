import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppLogEntry, AppSettings, ArchiveBatch, QueueItem } from '../main/types';

export type QueueState = {
  items: QueueItem[];
  archiveBatches: ArchiveBatch[];
  activeJobId: string | null;
  hasRunningJob: boolean;
  isPaused: boolean;
};

const api = {
  file: {
    readText: (filePath: string) => ipcRenderer.invoke('file:readText', filePath),
    writeText: (filePath: string, content: string) => ipcRenderer.invoke('file:writeText', filePath, content)
  },
  queue: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke('queue:pickFiles'),
    add: (sourcePaths: string[]): Promise<{ ok: true }> => ipcRenderer.invoke('queue:add', sourcePaths),
    list: (): Promise<QueueState> => ipcRenderer.invoke('queue:list'),
    removeSelected: (ids: string[]): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('queue:removeSelected', ids),
    resetSelected: (ids: string[]): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('queue:resetSelected', ids),
    archiveCompleted: (): Promise<{ ok: true }> => ipcRenderer.invoke('queue:archiveCompleted'),
    start: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('queue:start'),
    pause: (): Promise<{ ok: true }> => ipcRenderer.invoke('queue:pause'),
    resume: (): Promise<{ ok: true }> => ipcRenderer.invoke('queue:resume'),
    cancelCurrent: (): Promise<{ ok: true }> => ipcRenderer.invoke('queue:cancelCurrent'),
    openOutputFolder: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('queue:openOutputFolder', id),
    onState: (listener: (state: QueueState) => void): (() => void) => {
      const wrapped = (_event: unknown, payload: QueueState) => listener(payload);
      ipcRenderer.on('queue:state', wrapped);
      return () => {
        ipcRenderer.removeListener('queue:state', wrapped);
      };
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (next: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', next),
    pickOutputDirectory: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('settings:pickOutputDirectory', defaultPath)
  },
  logs: {
    list: (): Promise<AppLogEntry[]> => ipcRenderer.invoke('app-log:list'),
    onEntry: (listener: (entry: AppLogEntry) => void): (() => void) => {
      const wrapped = (_event: unknown, payload: AppLogEntry) => listener(payload);
      ipcRenderer.on('app-log:entry', wrapped);
      return () => {
        ipcRenderer.removeListener('app-log:entry', wrapped);
      };
    }
  },
  window: {
    fitContent: (contentHeight: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:fit-content', contentHeight)
  }
};

contextBridge.exposeInMainWorld('transcripter', api);

export type TranscripterApi = typeof api;
