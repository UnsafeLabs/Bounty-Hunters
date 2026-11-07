import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as Electron from "electron";
import * as path from "path";

export type TrayStatus = "connected" | "reconnecting" | "disconnected";

export interface TrayState {
  readonly status: TrayStatus;
  readonly projectName: string | null;
  readonly recentProjects: readonly string[];
}

export interface SystemTrayServiceShape {
  readonly initialize: Effect.Effect<void>;
  readonly updateStatus: (status: TrayStatus) => Effect.Effect<void>;
  readonly updateProjectName: (name: string | null) => Effect.Effect<void>;
  readonly updateRecentProjects: (projects: readonly string[]) => Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class SystemTrayService extends Context.Service<SystemTrayService, SystemTrayServiceShape>()(
  "t3/desktop/SystemTrayService",
) {}

const STATUS_COLORS: Record<TrayStatus, string> = {
  connected: "green",
  reconnecting: "yellow",
  disconnected: "red",
};

const STATUS_LABELS: Record<TrayStatus, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting...",
  disconnected: "Disconnected",
};

const make = Effect.gen(function* () {
  const trayRef = yield* Ref.make<Electron.Tray | null>(null);
  const stateRef = yield* Ref.make<TrayState>({
    status: "disconnected",
    projectName: null,
    recentProjects: [],
  });

  const getIconPath = (status: TrayStatus): string => {
    const color = STATUS_COLORS[status];
    // In production, these would be actual icon files
    // For now, we'll use a placeholder path
    return path.join(__dirname, "..", "..", "assets", `tray-${color}.png`);
  };

  const buildTooltip = (state: TrayState): string => {
    const statusLabel = STATUS_LABELS[state.status];
    const projectInfo = state.projectName ? ` - ${state.projectName}` : "";
    return `T3 Code: ${statusLabel}${projectInfo}`;
  };

  const buildContextMenu = (state: TrayState): Electron.Menu => {
    const mainWindow = Electron.BrowserWindow.getAllWindows()[0];
    const isWindowVisible = mainWindow?.isVisible() ?? false;

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: isWindowVisible ? "Hide Window" : "Show Window",
        click: () => {
          if (mainWindow) {
            if (isWindowVisible) {
              mainWindow.hide();
            } else {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
      },
      { type: "separator" },
      {
        label: "New Chat",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("tray:new-chat");
          }
        },
      },
      { type: "separator" },
      {
        label: "Open Recent Project",
        submenu:
          state.recentProjects.length > 0
            ? state.recentProjects.slice(0, 5).map((project) => ({
                label: project,
                click: () => {
                  if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.webContents.send("tray:open-project", project);
                  }
                },
              }))
            : [{ label: "No recent projects", enabled: false }],
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          Electron.app.quit();
        },
      },
    ];

    return Electron.Menu.buildFromTemplate(template);
  };

  const updateTray = Effect.fn("desktop.tray.updateTray")(function* () {
    const tray = yield* Ref.get(trayRef);
    const state = yield* Ref.get(stateRef);

    if (!tray) return;

    // Update icon
    const iconPath = getIconPath(state.status);
    try {
      tray.setImage(iconPath);
    } catch {
      // Icon file might not exist yet, continue with default
    }

    // Update tooltip
    tray.setToolTip(buildTooltip(state));

    // Update context menu
    tray.setContextMenu(buildContextMenu(state));
  });

  const initialize = Effect.fn("desktop.tray.initialize")(function* () {
    // Check if tray is already initialized
    const existingTray = yield* Ref.get(trayRef);
    if (existingTray) return;

    // Create tray icon
    const iconPath = getIconPath("disconnected");
    let tray: Electron.Tray;

    try {
      tray = new Electron.Tray(iconPath);
    } catch {
      // If icon doesn't exist, create with empty icon (will be updated later)
      tray = new Electron.Tray(Electron.nativeImage.createEmpty());
    }

    // Set initial tooltip
    const state = yield* Ref.get(stateRef);
    tray.setToolTip(buildTooltip(state));

    // Set initial context menu
    tray.setContextMenu(buildContextMenu(state));

    // Platform-specific click behavior
    if (process.platform === "darwin") {
      // macOS: clicking tray icon toggles window
      tray.on("click", () => {
        const mainWindow = Electron.BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      });
    } else {
      // Windows/Linux: left click shows window, right click shows menu
      tray.on("click", (event) => {
        if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
          return; // Don't handle modified clicks
        }

        const mainWindow = Electron.BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    }

    // Store tray reference
    yield* Ref.set(trayRef, tray);

    // Initial update
    yield* updateTray;
  });

  const updateStatus = (status: TrayStatus) =>
    Effect.gen(function* () {
      yield* Ref.update(stateRef, (state) => ({ ...state, status }));
      yield* updateTray;
    });

  const updateProjectName = (name: string | null) =>
    Effect.gen(function* () {
      yield* Ref.update(stateRef, (state) => ({ ...state, projectName: name }));
      yield* updateTray;
    });

  const updateRecentProjects = (projects: readonly string[]) =>
    Effect.gen(function* () {
      yield* Ref.update(stateRef, (state) => ({ ...state, recentProjects: projects }));
      yield* updateTray;
    });

  const destroy = Effect.fn("desktop.tray.destroy")(function* () {
    const tray = yield* Ref.get(trayRef);
    if (tray) {
      tray.destroy();
      yield* Ref.set(trayRef, null);
    }
  });

  return SystemTrayService.of({
    initialize,
    updateStatus,
    updateProjectName,
    updateRecentProjects,
    destroy,
  });
});

export const SystemTrayServiceLive = Layer.effect(SystemTrayService, make);
