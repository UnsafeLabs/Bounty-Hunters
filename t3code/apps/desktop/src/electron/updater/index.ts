import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';

const store = new Store();

interface UpdateState {
  deferredUntil?: number;
  skippedVersions?: string[];
}

export function setupAutoUpdater(mainWindow: any) {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    const updateState: UpdateState = store.get('updateState', {});
    const skippedVersions = updateState.skippedVersions || [];
    const deferredUntil = updateState.deferredUntil || 0;
    const now = Date.now();

    if (skippedVersions.includes(info.version)) {
      return;
    }

    if (deferredUntil > now) {
      return;
    }

    mainWindow.webContents.send('update:available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update:downloaded', info);
  });

  autoUpdater.on('error', (error) => {
    mainWindow.webContents.send('update:error', error.message);
  });

  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate();
  });

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('update:defer', (_, hours: number = 24) => {
    const deferredUntil = Date.now() + hours * 60 * 60 * 1000;
    const updateState: UpdateState = store.get('updateState', {});
    store.set('updateState', { ...updateState, deferredUntil });
  });

  ipcMain.handle('update:skip-version', (_, version: string) => {
    const updateState: UpdateState = store.get('updateState', {});
    const skippedVersions = updateState.skippedVersions || [];
    if (!skippedVersions.includes(version)) {
      skippedVersions.push(version);
    }
    store.set('updateState', { ...updateState, skippedVersions });
  });
}
