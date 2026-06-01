/**
 * System tray icon with context menu and status indicator.
 */

import { Tray, Menu, nativeImage, BrowserWindow } from "electron";
import { join } from "path";

interface TrayConfig {
  iconPath?: string;
  tooltip?: string;
}

export class SystemTrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private status: "idle" | "building" | "error" | "connected" = "idle";

  constructor(mainWindow: BrowserWindow, config: TrayConfig = {}) {
    this.mainWindow = mainWindow;
    this.createTray(config);
  }

  private createTray(config: TrayConfig): void {
    const iconPath = config.iconPath || join(__dirname, "../../resources/tray-icon.png");
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
    this.tray.setToolTip(config.tooltip || "t3code");
    this.updateMenu();
    this.tray.on("click", () => this.toggleWindow());
  }

  setStatus(status: typeof this.status): void {
    this.status = status;
    this.updateMenu();
  }

  private updateMenu(): void {
    if (!this.tray) return;
    const menu = Menu.buildFromTemplate([
      { label: "Show Window", click: () => this.showWindow() },
      { label: `Status: ${this.status}`, enabled: false },
      { type: "separator" },
      { label: "Quit", click: () => process.exit(0) },
    ]);
    this.tray.setContextMenu(menu);
  }

  private toggleWindow(): void {
    if (this.mainWindow?.isVisible()) this.mainWindow.hide();
    else this.mainWindow?.show();
  }

  private showWindow(): void {
    this.mainWindow?.show();
    this.mainWindow?.focus();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
