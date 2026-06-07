import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

export type BackendStatus = "connected" | "reconnecting" | "disconnected";

export interface ElectronTrayShape {
  readonly create: (
    iconPath: string,
  ) => Effect.Effect<void>;
  readonly updateBackendStatus: (status: BackendStatus) => Effect.Effect<void>;
  readonly updateTooltip: (text: string) => Effect.Effect<void>;
  readonly updateRecentProjects: (projects: readonly string[]) => Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class ElectronTray extends Context.Service<ElectronTray, ElectronTrayShape>()(
  "t3/desktop/electron/Tray",
) {}

const STATUS_ICONS: Record<BackendStatus, { label: string; hexColor: string }> = {
  connected: { label: "●", hexColor: "#4CAF50" },
  reconnecting: { label: "●", hexColor: "#FFC107" },
  disconnected: { label: "●", hexColor: "#F44336" },
};

const createStatusIcon = (status: BackendStatus): Electron.NativeImage => {
  const { label } = STATUS_ICONS[status];
  // Create a 16x16 canvas with the status dot
  const size = 16;
  const canvas = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="8" cy="8" r="6" fill="${STATUS_ICONS[status].hexColor}" />
    </svg>
  `;
  return Electron.nativeImage.createFromBuffer(
    Buffer.from(canvas),
    { width: size, height: size },
  );
};

export const layer = Layer.effect(
  ElectronTray,
  Effect.gen(function* () {
    const trayRef = yield* Ref.make<Option.Option<Electron.Tray>>(Option.none());
    const statusRef = yield* Ref.make<BackendStatus>("disconnected");
    const recentProjectsRef = yield* Ref.make<readonly string[]>([]);
    const tooltipRef = yield* Ref.make("T3 Code — Disconnected");

    const updateContextMenu = Effect.gen(function* () {
      const tray = yield* Ref.get(trayRef);
      if (Option.isNone(tray)) return;

      const status = yield* Ref.get(statusRef);
      const recentProjects = yield* Ref.get(recentProjectsRef);
      const tooltip = yield* Ref.get(tooltipRef);

      const statusLabel = STATUS_ICONS[status].label;
      const statusText =
        status === "connected"
          ? "Connected"
          : status === "reconnecting"
            ? "Reconnecting..."
            : "Disconnected";

      const recentProjectsSubmenu: Electron.MenuItemConstructorOptions[] =
        recentProjects.length > 0
          ? [
              { type: "separator" },
              ...recentProjects.slice(0, 5).map(
                (project): Electron.MenuItemConstructorOptions => ({
                  label: project,
                  click: () => {
                    const focusedWindow = Electron.BrowserWindow.getFocusedWindow();
                    if (focusedWindow) {
                      focusedWindow.webContents.send("tray:open-project", project);
                    }
                  },
                }),
              ),
            ]
          : [];

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: `${statusLabel} ${statusText}`,
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Show/Hide Window",
          click: () => {
            const windows = Electron.BrowserWindow.getAllWindows();
            const visibleWindow = windows.find((w) => !w.isDestroyed() && w.isVisible());
            if (visibleWindow) {
              visibleWindow.hide();
            } else {
              const anyWindow = windows.find((w) => !w.isDestroyed());
              if (anyWindow) {
                anyWindow.show();
                anyWindow.focus();
              }
            }
          },
        },
        {
          label: "New Chat",
          click: () => {
            const focusedWindow = Electron.BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              focusedWindow.webContents.send("tray:new-chat");
            }
          },
        },
        {
          label: "Open Recent Project",
          submenu: recentProjectsSubmenu.length > 0 ? recentProjectsSubmenu : [{ label: "No recent projects", enabled: false }],
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            Electron.app.quit();
          },
        },
      ];

      const contextMenu = Electron.Menu.buildFromTemplate(template);
      tray.value.setContextMenu(contextMenu);
      tray.value.setToolTip(tooltip);
    });

    return ElectronTray.of({
      create: (iconPath) =>
        Effect.gen(function* () {
          // Destroy existing tray if any
          const existing = yield* Ref.get(trayRef);
          if (Option.isSome(existing)) {
            existing.value.destroy();
          }

          const icon = Electron.nativeImage.createFromPath(iconPath);
          const tray = new Electron.Tray(icon.isEmpty() ? Electron.nativeImage.createEmpty() : icon);

          // Platform-specific click behavior
          if (process.platform === "darwin") {
            // macOS: click toggles window visibility
            tray.on("click", () => {
              const windows = Electron.BrowserWindow.getAllWindows();
              const visibleWindow = windows.find((w) => !w.isDestroyed() && w.isVisible());
              if (visibleWindow) {
                visibleWindow.hide();
              } else {
                const anyWindow = windows.find((w) => !w.isDestroyed());
                if (anyWindow) {
                  anyWindow.show();
                  anyWindow.focus();
                }
              }
            });
          } else {
            // Windows/Linux: left click shows window
            tray.on("click", () => {
              const windows = Electron.BrowserWindow.getAllWindows();
              const anyWindow = windows.find((w) => !w.isDestroyed());
              if (anyWindow) {
                anyWindow.show();
                anyWindow.focus();
              }
            });
          }

          yield* Ref.set(trayRef, Option.some(tray));
          yield* updateContextMenu;
        }),

      updateBackendStatus: (status) =>
        Effect.gen(function* () {
          yield* Ref.set(statusRef, status);
          const tray = yield* Ref.get(trayRef);
          if (Option.isSome(tray)) {
            // Update tray icon to reflect status
            const statusIcon = createStatusIcon(status);
            if (!statusIcon.isEmpty()) {
              tray.value.setImage(statusIcon);
            }
          }
          yield* updateContextMenu;
        }),

      updateTooltip: (text) =>
        Effect.gen(function* () {
          yield* Ref.set(tooltipRef, text);
          yield* updateContextMenu;
        }),

      updateRecentProjects: (projects) =>
        Effect.gen(function* () {
          yield* Ref.set(recentProjectsRef, projects);
          yield* updateContextMenu;
        }),

      destroy: Effect.gen(function* () {
        const tray = yield* Ref.get(trayRef);
        if (Option.isSome(tray)) {
          tray.value.destroy();
          yield* Ref.set(trayRef, Option.none());
        }
      }),
    });
  }),
);
