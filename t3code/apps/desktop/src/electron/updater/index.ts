import { autoUpdater } from "electron-updater";
import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";

const store = new Store<{
  deferredUntil?: number;
  skippedVersions: string[];
}>({
  name: "updater-config",
  defaults: { skippedVersions: [] },
});

let mainWindow: BrowserWindow | null = null;
let deferredCheck = false;

export function initUpdater(window: BrowserWindow) {
  mainWindow = window;
  
  autoUpdater.autoDownload = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    mainWindow?.webContents.send("update-status", { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    const skipped = store.get("skippedVersions", []);
    if (skipped.includes(info.version)) {
      return;
    }
    
    if (deferredCheck) return;

    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes || "",
      releaseDate: info.releaseDate || "",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded", {});
  });

  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("update-error", { message: error.message });
  });

  ipcMain.handle("update:download", async () => {
    await autoUpdater.downloadUpdate();
  });

  ipcMain.handle("update:install", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("update:defer", () => {
    store.set("deferredUntil", Date.now() + 24 * 60 * 60 * 1000);
  });

  ipcMain.handle("update:skip", (_event, version: string) => {
    const skipped = store.get("skippedVersions", []);
    if (!skipped.includes(version)) {
      skipped.push(version);
      store.set("skippedVersions", skipped);
    }
  });

  ipcMain.handle("update:get-config", () => {
    return {
      deferredUntil: store.get("deferredUntil"),
      skippedVersions: store.get("skippedVersions"),
    };
  });
}

export function checkForUpdates() {
  const deferredUntil = store.get("deferredUntil");
  if (deferredUntil && Date.now() < deferredUntil) {
    deferredCheck = true;
    setTimeout(() => { deferredCheck = false; }, deferredUntil - Date.now());
    return;
  }
  autoUpdater.checkForUpdates();
}

export function resetDefer() {
  store.delete("deferredUntil");
  deferredCheck = false;
}

export function clearSkipped() {
  store.set("skippedVersions", []);
}