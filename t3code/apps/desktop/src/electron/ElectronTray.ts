import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "./ElectronApp.ts";
import * as ElectronWindow from "./ElectronWindow.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

export type TrayBackendStatus = "connected" | "reconnecting" | "disconnected";

export interface TrayRecentProject {
  readonly name?: string;
  readonly path: string;
}

export interface TrayState {
  readonly backendStatus: TrayBackendStatus;
  readonly activeProjectName: string | null;
  readonly recentProjects: readonly TrayRecentProject[];
}

export interface ElectronTrayShape {
  readonly configure: Effect.Effect<void, never, Scope.Scope>;
  readonly updateState: (patch: Partial<TrayState>) => Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class ElectronTray extends Context.Service<ElectronTray, ElectronTrayShape>()(
  "t3/desktop/electron/Tray",
) {}

const STATUS_LABELS: Record<TrayBackendStatus, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

const STATUS_COLORS: Record<TrayBackendStatus, string> = {
  connected: "#16a34a",
  reconnecting: "#ca8a04",
  disconnected: "#dc2626",
};

const DEFAULT_STATE: TrayState = {
  backendStatus: "reconnecting",
  activeProjectName: null,
  recentProjects: [],
};

export function statusColor(status: TrayBackendStatus): string {
  return STATUS_COLORS[status];
}

export function buildTrayTooltip(input: {
  readonly displayName: string;
  readonly state: TrayState;
}): string {
  const lines = [
    input.displayName,
    `Status: ${STATUS_LABELS[input.state.backendStatus]}`,
  ];
  if (input.state.activeProjectName !== null && input.state.activeProjectName.trim().length > 0) {
    lines.push(`Project: ${input.state.activeProjectName.trim()}`);
  }
  return lines.join("\n");
}

export function normalizeRecentProjects(
  projects: readonly TrayRecentProject[],
): readonly Required<TrayRecentProject>[] {
  const seenPaths = new Set<string>();
  const normalized: Required<TrayRecentProject>[] = [];

  for (const project of projects) {
    const projectPath = project.path.trim();
    if (projectPath.length === 0 || seenPaths.has(projectPath)) {
      continue;
    }

    seenPaths.add(projectPath);
    const rawName = project.name?.trim();
    normalized.push({
      path: projectPath,
      name:
        rawName && rawName.length > 0
          ? rawName
          : projectPath.split(/[\\/]/).at(-1) ?? projectPath,
    });

    if (normalized.length >= 5) {
      break;
    }
  }

  return normalized;
}

export function buildTrayIcon(status: TrayBackendStatus): Electron.NativeImage {
  const color = statusColor(status);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="7" fill="#111827"/>',
    `<circle cx="23" cy="9" r="5" fill="${color}"/>`,
    '<path d="M8 10h10v3h-3v11h-4V13H8z" fill="#f9fafb"/>',
    "</svg>",
  ].join("");
  return Electron.nativeImage
    .createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    .resize({ width: 16, height: 16 });
}

export function buildTrayMenuTemplate(input: {
  readonly isWindowVisible: boolean;
  readonly recentProjects: readonly TrayRecentProject[];
  readonly onToggleWindow: () => void;
  readonly onNewChat: () => void;
  readonly onOpenRecentProject: (projectPath: string) => void;
  readonly onQuit: () => void;
}): Electron.MenuItemConstructorOptions[] {
  const recentProjects = normalizeRecentProjects(input.recentProjects);

  return [
    {
      label: input.isWindowVisible ? "Hide Window" : "Show Window",
      click: input.onToggleWindow,
    },
    {
      label: "New Chat",
      click: input.onNewChat,
    },
    {
      label: "Open Recent Project",
      submenu:
        recentProjects.length > 0
          ? recentProjects.map((project) => ({
              label: project.name,
              click: () => input.onOpenRecentProject(project.path),
            }))
          : [{ label: "No recent projects", enabled: false }],
    },
    { type: "separator" },
    {
      label: "Quit",
      click: input.onQuit,
    },
  ];
}

const make = Effect.gen(function* () {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopState = yield* DesktopState.DesktopState;
  const context = yield* Effect.context<
    | DesktopWindow.DesktopWindow
    | ElectronApp.ElectronApp
    | ElectronWindow.ElectronWindow
    | DesktopEnvironment.DesktopEnvironment
    | DesktopState.DesktopState
  >();
  const runPromise = Effect.runPromiseWith(context);
  const stateRef = yield* Ref.make<TrayState>(DEFAULT_STATE);
  const trayRef = yield* Ref.make<Option.Option<Electron.Tray>>(Option.none());

  const withTray = <A>(f: (tray: Electron.Tray) => A): Effect.Effect<Option.Option<A>> =>
    Ref.get(trayRef).pipe(
      Effect.map((tray) => {
        if (Option.isNone(tray)) {
          return Option.none();
        }
        return Option.some(f(tray.value));
      }),
    );

  const revealMainWindow = desktopWindow.activate;

  const hideMainWindow = Effect.gen(function* () {
    const currentWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(currentWindow) && !currentWindow.value.isDestroyed()) {
      currentWindow.value.hide();
    }
  });

  const toggleMainWindow = Effect.gen(function* () {
    const currentWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(currentWindow) && currentWindow.value.isVisible()) {
      currentWindow.value.hide();
      return;
    }
    yield* revealMainWindow;
  });

  const refreshTray = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const visible = yield* electronWindow.currentMainOrFirst.pipe(
      Effect.map((window) => Option.isSome(window) && window.value.isVisible()),
    );

    yield* withTray((tray) => {
      tray.setImage(buildTrayIcon(state.backendStatus));
      tray.setToolTip(buildTrayTooltip({ displayName: environment.displayName, state }));
      tray.setContextMenu(
        Electron.Menu.buildFromTemplate(
          buildTrayMenuTemplate({
            isWindowVisible: visible,
            recentProjects: state.recentProjects,
            onToggleWindow: () => {
              void runPromise(visible ? hideMainWindow : revealMainWindow);
            },
            onNewChat: () => {
              void runPromise(desktopWindow.dispatchMenuAction("new-chat"));
            },
            onOpenRecentProject: (projectPath) => {
              void runPromise(desktopWindow.dispatchMenuAction(`open-project:${projectPath}`));
            },
            onQuit: () => {
              void runPromise(
                Ref.set(desktopState.quitting, true).pipe(Effect.andThen(electronApp.quit)),
              );
            },
          }),
        ),
      );
    });
  });

  return ElectronTray.of({
    configure: Effect.gen(function* () {
      const existingTray = yield* Ref.get(trayRef);
      if (Option.isSome(existingTray)) {
        return;
      }

      const initialState = yield* Ref.get(stateRef);
      const tray = new Electron.Tray(buildTrayIcon(initialState.backendStatus));
      yield* Ref.set(trayRef, Option.some(tray));

      tray.on("click", () => {
        void runPromise(environment.platform === "darwin" ? toggleMainWindow : revealMainWindow);
      });
      tray.on("right-click", () => {
        void runPromise(
          refreshTray.pipe(Effect.andThen(Effect.sync(() => tray.popUpContextMenu()))),
        );
      });

      yield* refreshTray;
      yield* Effect.addFinalizer(() =>
        Ref.get(trayRef).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (activeTray) =>
                Effect.sync(() => {
                  activeTray.destroy();
                }),
            }),
          ),
          Effect.andThen(Ref.set(trayRef, Option.none())),
        ),
      );
    }).pipe(Effect.withSpan("desktop.tray.configure")),
    updateState: (patch) =>
      Ref.update(stateRef, (current) => ({
        ...current,
        ...patch,
        recentProjects:
          patch.recentProjects === undefined
            ? current.recentProjects
            : normalizeRecentProjects(patch.recentProjects),
      })).pipe(Effect.andThen(refreshTray)),
    destroy: Ref.get(trayRef).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (tray) =>
            Effect.sync(() => {
              tray.destroy();
            }),
        }),
      ),
      Effect.andThen(Ref.set(trayRef, Option.none())),
    ),
  });
});

export const layer = Layer.effect(ElectronTray, make);
