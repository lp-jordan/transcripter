import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import './ipc';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const PREFERRED_WINDOW_SIZE = { width: 1200, height: 900 };
const MIN_WINDOW_SIZE = { width: 980, height: 760 };

type WindowSizing = {
  initialWidth: number;
  initialHeight: number;
  minWidth: number;
  minHeight: number;
};

const getInitialWindowSizing = (): WindowSizing => {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const minWidth = Math.min(MIN_WINDOW_SIZE.width, workAreaSize.width);
  const minHeight = Math.min(MIN_WINDOW_SIZE.height, workAreaSize.height);

  return {
    initialWidth: Math.min(Math.max(PREFERRED_WINDOW_SIZE.width, minWidth), workAreaSize.width),
    initialHeight: Math.min(Math.max(PREFERRED_WINDOW_SIZE.height, minHeight), workAreaSize.height),
    minWidth,
    minHeight
  };
};

const createMainWindow = async (): Promise<void> => {
  const sizing = getInitialWindowSizing();
  const mainWindow = new BrowserWindow({
    width: sizing.initialWidth,
    height: sizing.initialHeight,
    minWidth: sizing.minWidth,
    minHeight: sizing.minHeight,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(async () => {
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
