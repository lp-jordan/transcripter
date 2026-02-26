import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import './ipc';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEFAULT_WINDOW_SIZE = { width: 1200, height: 900 };
const MIN_WINDOW_SIZE = { width: 980, height: 760 };

const getInitialWindowBounds = () => {
  const { workAreaSize } = screen.getPrimaryDisplay();

  return {
    width: Math.min(Math.max(DEFAULT_WINDOW_SIZE.width, MIN_WINDOW_SIZE.width), workAreaSize.width),
    height: Math.min(Math.max(DEFAULT_WINDOW_SIZE.height, MIN_WINDOW_SIZE.height), workAreaSize.height)
  };
};

const createMainWindow = async (): Promise<void> => {
  const initialBounds = getInitialWindowBounds();
  const mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
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
