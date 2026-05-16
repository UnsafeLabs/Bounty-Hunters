/**
 * System tray icon with context menu and status indicator.
 *
 * Provides quick access to common actions when the main window is minimized.
 *
 * @module SystemTray
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

export type TrayStatus = "connected" | "reconnecting" | "disconnected";

export interface SystemTrayShape {
  readonly create: Effect.Effect<void>;
  readonly updateStatus: (status: TrayStatus) => Effect.Effect<void>;
  readonly updateProjectName: (name: string | undefined) => Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class SystemTray extends Context.Service<SystemTray, SystemTrayShape>()(
  "t3/desktop/SystemTray",
) {}

const STATUS_ICONS: Record<TrayStatus, string> = {
  connected: "🟢",
  reconnecting: "🟡",
  disconnected: "🔴",
};

const make = Effect.gen(function* () {
  const trayRef = yield* Ref.make<Electron.Tray | null>(null);
  const statusRef = yield* Ref.make<TrayStatus>("disconnected");
  const projectRef = yield* Ref.make<string | undefined>(undefined);

  const getTooltip = (status: TrayStatus, project: string | undefined) => {
    const statusText = STATUS_ICONS[status];
    const projectText = project ? ` - ${project}` : "";
    return `T3 Code ${statusText}${projectText}`;
  };

  const createContextMenu = (window: Electron.BrowserWindow | null) => {
    const recentProjects: Electron.MenuItemConstructorOptions[] = [
      { label: "No recent projects", enabled: false },
    ];

    return Electron.Menu.buildFromTemplate([
      {
        label: "Show/Hide Window",
        click: () => {
          if (window) {
            if (window.isVisible()) {
              window.hide();
            } else {
              window.show();
              window.focus();
            }
          }
        },
      },
      { type: "separator" },
      {
        label: "New Chat",
        click: () => {
          if (window) {
            window.show();
            window.webContents.send("new-chat");
          }
        },
      },
      {
        label: "Open Recent Project",
        submenu: recentProjects,
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          Electron.app.quit();
        },
      },
    ]);
  };

  const create = Effect.sync(() => {
    // Get the icon path (you'll need to provide an actual icon)
    const icon = Electron.nativeImage.createEmpty();

    const tray = new Electron.Tray(icon);
    tray.setToolTip(getTooltip("disconnected", undefined));

    const window = Electron.BrowserWindow.getAllWindows()[0] ?? null;
    tray.setContextMenu(createContextMenu(window));

    // Platform-specific click behavior
    tray.on("click", () => {
      if (process.platform === "darwin") {
        // macOS: toggle window visibility
        if (window) {
          if (window.isVisible()) {
            window.hide();
          } else {
            window.show();
            window.focus();
          }
        }
      } else {
        // Windows/Linux: show window
        if (window) {
          window.show();
          window.focus();
        }
      }
    });

    Ref.set(trayRef, tray);
  });

  const updateStatus = (status: TrayStatus) =>
    Effect.sync(() => {
      Ref.set(statusRef, status);
      const tray = Ref.get(trayRef);
      const project = Ref.get(projectRef);
      if (tray) {
        tray.setToolTip(getTooltip(status, project));
      }
    });

  const updateProjectName = (name: string | undefined) =>
    Effect.sync(() => {
      Ref.set(projectRef, name);
      const tray = Ref.get(trayRef);
      const status = Ref.get(statusRef);
      if (tray) {
        tray.setToolTip(getTooltip(status, name));
      }
    });

  const destroy = Effect.sync(() => {
    const tray = Ref.get(trayRef);
    if (tray) {
      tray.destroy();
      Ref.set(trayRef, null);
    }
  });

  return SystemTray.of({
    create,
    updateStatus,
    updateProjectName,
    destroy,
  });
});

export const layer = Layer.effect(SystemTray, make);
