import { autoUpdater } from "electron-updater";
import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";
const store = new Store<{ deferredUntil?: number; skippedVersions: string[] }>({ name: "updater-config", defaults: { skippedVersions: [] } });
let mainWindow: BrowserWindow | null = null; let deferredCheck = false;
export function initUpdater(window: BrowserWindow) {
  mainWindow = window; autoUpdater.autoDownload = false;
  autoUpdater.on("checking-for-update", () => mainWindow?.webContents.send("update-status", { status: "checking" }));
  autoUpdater.on("update-available", (info) => { if (store.get("skippedVersions", []).includes(info.version) || deferredCheck) return; mainWindow?.webContents.send("update-available", { version: info.version, releaseNotes: info.releaseNotes || "" }); });
  autoUpdater.on("download-progress", (p) => mainWindow?.webContents.send("update-download-progress", { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }));
  autoUpdater.on("update-downloaded", () => mainWindow?.webContents.send("update-downloaded", {}));
  autoUpdater.on("error", (e) => mainWindow?.webContents.send("update-error", { message: e.message }));
  ipcMain.handle("update:download", async () => autoUpdater.downloadUpdate());
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());
  ipcMain.handle("update:defer", () => store.set("deferredUntil", Date.now() + 86400000));
  ipcMain.handle("update:skip", (_e, v: string) => { const s = store.get("skippedVersions", []); if (!s.includes(v)) { s.push(v); store.set("skippedVersions", s); } });
  ipcMain.handle("update:get-config", () => ({ deferredUntil: store.get("deferredUntil"), skippedVersions: store.get("skippedVersions") }));
}
export function checkForUpdates() { const du = store.get("deferredUntil"); if (du && Date.now() < du) { deferredCheck = true; setTimeout(() => { deferredCheck = false; }, du - Date.now()); return; } autoUpdater.checkForUpdates(); }
