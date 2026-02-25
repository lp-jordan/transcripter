/// <reference types="vite/client" />

import type { TranscripterApi } from '../preload/preload';

declare global {
  interface Window {
    transcripter: TranscripterApi;
  }
}

export {};
