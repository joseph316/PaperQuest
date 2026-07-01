import { app, BrowserWindow, shell, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, copyFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let server = null;
const PORT = 8787;

function getAppRoot() {
  // In development and packaged asar builds, __dirname points to the app source root.
  return __dirname;
}

async function startLocalServer() {
  const appRoot = getAppRoot();
  const dataDir = app.getPath('userData');

  process.env.APP_ROOT = appRoot;
  process.env.DATA_DIR = dataDir;
  process.env.PORT = String(PORT);

  // First-run migration: keep bundled sample/current data if userData has no data yet.
  const bundledData = path.join(appRoot, 'paperquest-data.json');
  const userData = path.join(dataDir, 'paperquest-data.json');
  if (!existsSync(userData) && existsSync(bundledData)) {
    try {
      copyFileSync(bundledData, userData);
    } catch {
      // If copying fails, the server will create an empty data file.
    }
  }

  const { startPaperQuestServer } = await import('./server.mjs');
  server = await startPaperQuestServer({ port: PORT });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'PaperQuest',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    await startLocalServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('PaperQuest 실행 오류', error?.message || String(error));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) {
    try { server.close(); } catch {}
  }
});
