/**
 * Auto-updater with download progress, defer, and skip version.
 */

import { autoUpdater } from "electron-updater";
import { BrowserWindow, dialog } from "electron";

interface UpdateState {
  checking: boolean;
  available: boolean;
  version?: string;
  progress?: number;
  downloaded: boolean;
  skippedVersion?: string;
}

export class UpdateManager {
  private state: UpdateState = { checking: false, available: false, downloaded: false };
  private window: BrowserWindow | null = null;
  private skipKey = "skip-version";

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.on("update-available", (info) => {
      this.state = { ...this.state, available: true, version: info.version, checking: false };
      this.notify("update-available", info);
    });
    autoUpdater.on("download-progress", (progress) => {
      this.state.progress = progress.percent;
      this.notify("update-progress", progress);
    });
    autoUpdater.on("update-downloaded", () => {
      this.state.downloaded = true;
      this.notify("update-downloaded");
    });
  }

  setWindow(window: BrowserWindow): void { this.window = window; }

  async checkForUpdates(): Promise<void> {
    this.state.checking = true;
    await autoUpdater.checkForUpdates();
  }

  async downloadUpdate(): Promise<void> {
    await autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  defer(): void {
    this.state = { checking: false, available: false, downloaded: false };
  }

  skipVersion(): void {
    if (this.state.version) {
      localStorage.setItem(this.skipKey, this.state.version);
      this.state.skippedVersion = this.state.version;
      this.state = { checking: false, available: false, downloaded: false };
    }
  }

  private notify(event: string, data?: any): void {
    this.window?.webContents.send("updater:" + event, data);
  }
}
