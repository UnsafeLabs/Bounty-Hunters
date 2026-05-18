import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";

import * as Electron from "electron";
import * as Path from "node:path";

export type TrayConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface TrayState {
  readonly tooltip: string;
  readonly connectionStatus: TrayConnectionStatus;
  readonly activeProject: string | undefined;
  readonly recentProjects: readonly string[];
}

export interface ElectronTrayShape {
  readonly create: Effect.Effect<void, Error, Scope.Scope>;
  readonly updateStatus: (
    status: TrayConnectionStatus,
  ) => Effect.Effect<void>;
  readonly updateProject: (projectName: string) => Effect.Effect<void>;
  readonly addRecentProject: (projectName: string) => Effect.Effect<void>;
  readonly setTooltip: (text: string) => Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class ElectronTray extends Context.Service<ElectronTray, ElectronTrayShape>()(
  "t3/desktop/electron/Tray",
) {}

export interface ElectronTrayCallbacks {
  readonly onShowWindow: Effect.Effect<void>;
  readonly onHideWindow: Effect.Effect<void>;
  readonly onNewChat: Effect.Effect<void>;
  readonly onOpenRecent: (projectName: string) => Effect.Effect<void>;
  readonly onQuit: Effect.Effect<void>;
}

function getResourcesPath(): string {
  const appPath = Electron.app.getAppPath();
  // In development, resources are at <project>/resources
  // In production, they're in the app's resources directory
  return Path.join(appPath, "..", "..", "resources", "tray");
}

function getIconPath(status: TrayConnectionStatus): string {
  const resourcesPath = getResourcesPath();
  return Path.join(resourcesPath, `status-${status}.png`);
}

const make = (
  callbacks: ElectronTrayCallbacks,
  initialState: TrayState,
): Effect.Effect<ElectronTrayShape, Error, Scope.Scope> =>
  Effect.gen(function* (_) {
    const state = yield* _(Ref.make(initialState));

    let tray: Electron.Tray | null = null;

    const getTooltip = (s: TrayState): string => {
      const parts: string[] = [];
      const statusMap: Record<TrayConnectionStatus, string> = {
        connected: "🟢 Connected",
        reconnecting: "🟡 Reconnecting",
        disconnected: "🔴 Disconnected",
      };
      parts.push(statusMap[s.connectionStatus] ?? s.connectionStatus);
      if (s.activeProject) {
        parts.push(`- ${s.activeProject}`);
      }
      return parts.join(" ");
    };

    const updateTray = (s: TrayState): void => {
      if (!tray) return;
      tray.setToolTip(getTooltip(s));
      try {
        tray.setImage(getIconPath(s.connectionStatus));
      } catch {
        // Ignore icon errors (e.g., in test environments)
      }
    };

    const buildContextMenu = (s: TrayState): Electron.Menu => {
      const recentSubmenu: Electron.MenuItemConstructorOptions[] =
        s.recentProjects.length > 0
          ? s.recentProjects.slice(0, 5).map((project) => ({
              label: project,
              click: () => {
                Effect.runFork(callbacks.onOpenRecent(project));
              },
            }))
          : [{ label: "(No recent projects)", enabled: false }];

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: "Show/Hide Window",
          click: () => {
            const win = Electron.BrowserWindow.getAllWindows()[0];
            if (win) {
              if (win.isVisible()) {
                win.hide();
              } else {
                win.show();
                win.focus();
              }
            }
          },
        },
        { type: "separator" },
        {
          label: "New Chat",
          click: () => {
            Effect.runFork(callbacks.onNewChat);
          },
        },
        {
          label: "Open Recent Project",
          submenu: recentSubmenu,
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            Effect.runFork(callbacks.onQuit);
          },
        },
      ];

      return Electron.Menu.buildFromTemplate(template);
    };

    return ElectronTray.of({
      create: Effect.gen(function* (_) {
        const iconPath = getIconPath(initialState.connectionStatus);

        tray = new Electron.Tray(iconPath);
        tray.setToolTip(getTooltip(initialState));

        // Platform-specific click behavior
        if (process.platform === "darwin") {
          // macOS: toggle window
          tray.on("click", () => {
            const win = Electron.BrowserWindow.getAllWindows()[0];
            if (win) {
              if (win.isVisible()) {
                win.hide();
              } else {
                win.show();
                win.focus();
              }
            }
          });
        } else {
          // Windows/Linux: left click shows window
          tray.on("click", () => {
            const win = Electron.BrowserWindow.getAllWindows()[0];
            if (win) {
              win.show();
              win.focus();
            }
          });
        }

        // Right-click context menu on all platforms
        const currentState = yield* _(Ref.get(state));
        tray.setContextMenu(buildContextMenu(currentState));

        // Register cleanup
        yield* _(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (tray) {
                tray.destroy();
                tray = null;
              }
            }),
          ),
        );
      }).pipe(
        Effect.scoped,
        Effect.orDie,
      ),

      updateStatus: (status) =>
        Ref.update(state, (s) => ({ ...s, connectionStatus: status })).pipe(
          Effect.flatMap(() => Ref.get(state)),
          Effect.flatMap((s) =>
            Effect.sync(() => {
              updateTray(s);
              if (tray) {
                tray.setContextMenu(buildContextMenu(s));
              }
            }),
          ),
        ),

      updateProject: (projectName) =>
        Ref.update(state, (s) => ({ ...s, activeProject: projectName })).pipe(
          Effect.flatMap(() => Ref.get(state)),
          Effect.tap((s) => Effect.sync(() => updateTray(s))),
        ),

      addRecentProject: (projectName) =>
        Ref.update(state, (s) => {
          const filtered = s.recentProjects.filter((p) => p !== projectName);
          return {
            ...s,
            recentProjects: [projectName, ...filtered].slice(0, 5),
          };
        }).pipe(
          Effect.flatMap(() => Ref.get(state)),
          Effect.tap((s) =>
            Effect.sync(() => {
              if (tray) {
                tray.setContextMenu(buildContextMenu(s));
              }
            }),
          ),
        ),

      setTooltip: (text) =>
        Ref.update(state, (s) => ({ ...s, tooltip: text })).pipe(
          Effect.flatMap(() => Ref.get(state)),
          Effect.tap((s) => Effect.sync(() => updateTray(s))),
        ),

      destroy: Effect.sync(() => {
        if (tray) {
          tray.destroy();
          tray = null;
        }
      }),
    });
  });

export const ElectronTrayLive = (
  callbacks: ElectronTrayCallbacks,
  initialState: TrayState,
): Layer.Layer<ElectronTray, Error, Scope.Scope> =>
  Layer.scoped(ElectronTray, make(callbacks, initialState));

export const defaultTrayState: TrayState = {
  tooltip: "T3 Code",
  connectionStatus: "disconnected",
  activeProject: undefined,
  recentProjects: [],
};
