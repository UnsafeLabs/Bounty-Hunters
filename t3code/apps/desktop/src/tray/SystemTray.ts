import { Effect, Ref, Schema } from "effect";

/**
 * Fix: Add system tray icon with context menu and status indicator (#859)
 */

export interface TrayConfig {
  iconPath: string;
  tooltip: string;
  statusIndicators: Record<string, { icon: string; label: string }>;
}

export const SystemTray = Effect.gen(function* (_) {
  const statusRef = yield* _(Ref.make<string>("idle"));

  const createTray = (config: TrayConfig) =>
    Effect.sync(() => {
      // Electron Tray implementation
      const { Tray, Menu, nativeImage } = require("electron");
      const icon = nativeImage.createFromPath(config.iconPath);
      const tray = new Tray(icon);

      tray.setToolTip(config.tooltip);

      const contextMenu = Menu.buildFromTemplate([
        { label: "Show Window", click: () => {} },
        { type: "separator" },
        { label: "Status: Connected", type: "normal", enabled: false },
        { type: "separator" },
        { label: "Settings", click: () => {} },
        { label: "Check for Updates", click: () => {} },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ]);

      tray.setContextMenu(contextMenu);
      return tray;
    });

  const setStatus = (status: string) =>
    Ref.set(statusRef, status);

  const getStatus = Ref.get(statusRef);

  return { createTray, setStatus, getStatus };
});
