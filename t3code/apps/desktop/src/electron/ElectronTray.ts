import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface ElectronTrayShape {
  readonly create: Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class ElectronTray extends Context.Service<ElectronTray, ElectronTrayShape>()(
  "t3/desktop/electron/Tray",
) {}

const make = Effect.gen(function* () {
  let tray: Electron.Tray | null = null;

  const create = Effect.sync(() => {
    if (tray) return;
    try {
      const { join } = require("path");
      const iconPath = join(__dirname, "../../resources/icon.png");
      tray = new Electron.Tray(iconPath);
      const contextMenu = Electron.Menu.buildFromTemplate([
        {
          label: "Show Window",
          click: () => {
            const win = Electron.BrowserWindow.getAllWindows()[0];
            if (win && !win.isDestroyed()) {
              win.show();
              win.focus();
            }
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            Electron.app.quit();
          },
        },
      ]);
      tray.setToolTip("T3 Code");
      tray.setContextMenu(contextMenu);
      tray.on("double-click", () => {
        const win = Electron.BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
        }
      });
    } catch {
      console.warn("Failed to create tray icon");
    }
  });

  const destroy = Effect.sync(() => {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  return ElectronTray.of({
    create,
    destroy,
  });
});

export const layer = Layer.effect(ElectronTray, make);
