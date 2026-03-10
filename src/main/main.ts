import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import './ipc';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEFAULT_WINDOW_SIZE = { width: 1200, height: 900 };
const MIN_WINDOW_SIZE = { width: 980, height: 760 };

const getConstrainedSizeForDisplay = (workAreaSize: { width: number; height: number }) => ({
  minWidth: Math.min(MIN_WINDOW_SIZE.width, workAreaSize.width),
  minHeight: Math.min(MIN_WINDOW_SIZE.height, workAreaSize.height),
  defaultWidth: Math.min(Math.max(DEFAULT_WINDOW_SIZE.width, MIN_WINDOW_SIZE.width), workAreaSize.width),
  defaultHeight: Math.min(Math.max(DEFAULT_WINDOW_SIZE.height, MIN_WINDOW_SIZE.height), workAreaSize.height)
});

const getInitialWindowBounds = () => {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const constrained = getConstrainedSizeForDisplay(workAreaSize);

  return {
    width: constrained.defaultWidth,
    height: constrained.defaultHeight,
    minWidth: constrained.minWidth,
    minHeight: constrained.minHeight
  };
};

const enforceDisplayWindowConstraints = (window: BrowserWindow) => {
  const display = screen.getDisplayMatching(window.getBounds());
  const constrained = getConstrainedSizeForDisplay(display.workAreaSize);
  window.setMinimumSize(constrained.minWidth, constrained.minHeight);

  const [width, height] = window.getSize();
  const boundedWidth = Math.min(width, display.workAreaSize.width);
  const boundedHeight = Math.min(height, display.workAreaSize.height);

  if (boundedWidth !== width || boundedHeight !== height) {
    window.setSize(boundedWidth, boundedHeight);
  }
};

const createMainWindow = async (): Promise<void> => {
  const initialBounds = getInitialWindowBounds();
  const mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: initialBounds.minWidth,
    minHeight: initialBounds.minHeight,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev
    }
  });

  const syncWindowConstraints = () => {
    enforceDisplayWindowConstraints(mainWindow);
  };

  mainWindow.on('move', syncWindowConstraints);
  mainWindow.on('resize', syncWindowConstraints);
  screen.on('display-metrics-changed', syncWindowConstraints);

  mainWindow.once('ready-to-show', () => {
    syncWindowConstraints();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    screen.off('display-metrics-changed', syncWindowConstraints);
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
