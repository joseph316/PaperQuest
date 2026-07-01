import { app, BrowserWindow, shell, dialog } from 'electron';
import updater from 'electron-updater';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, copyFileSync } from 'node:fs';

const { autoUpdater } = updater;
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
  const dataDir = path.join(app.getPath('appData'), 'PaperQuestData');

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

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 가능',
      message: '새 버전의 PaperQuest가 있습니다.',
      detail: '지금 다운로드할까요?',
      buttons: ['다운로드', '나중에'],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비 완료',
      message: '업데이트가 다운로드되었습니다.',
      detail: '앱을 재시작해서 업데이트를 설치할까요?',
      buttons: ['재시작', '나중에'],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', () => {
    // 초기 배포 전에는 에러가 날 수 있으므로 조용히 무시
  });
}

app.whenReady().then(async () => {
  try {
    await startLocalServer();
    createWindow();
    setupAutoUpdater();

    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    }
  } catch (error) {
    dialog.showErrorBox('PaperQuest 실행 오류', error?.message || String(error));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let isQuitting = false;

async function stopLocalServer() {
  if (!server) return;
  try {
    await new Promise((resolve) => server.close(resolve));
  } catch {}
  server = null;
}

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    isQuitting = true;
    await stopLocalServer();
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  await stopLocalServer();
  app.quit();
});

