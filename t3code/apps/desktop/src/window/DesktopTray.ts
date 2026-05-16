import {
  DESKTOP_TRAY_NEW_CHAT_ACTION,
  type DesktopTrayConnectionStatus,
  type DesktopTrayProject,
  type DesktopTrayState,
  encodeDesktopTrayOpenProjectAction,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const MAX_RECENT_PROJECTS = 5;

const STATUS_LABEL: Record<DesktopTrayConnectionStatus, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

const STATUS_COLOR: Record<DesktopTrayConnectionStatus, string> = {
  connected: "#22c55e",
  reconnecting: "#eab308",
  disconnected: "#ef4444",
};

export interface DesktopTrayShape {
  readonly configure: Effect.Effect<void, never, Scope.Scope>;
  readonly updateState: (state: DesktopTrayState) => Effect.Effect<void>;
}

export class DesktopTray extends Context.Service<DesktopTray, DesktopTrayShape>()(
  "t3/desktop/Tray",
) {}

type DesktopTrayRuntimeServices =
  | DesktopState.DesktopState
  | DesktopWindow.DesktopWindow
  | ElectronApp.ElectronApp
  | ElectronWindow.ElectronWindow;

export interface DesktopTrayMenuInput {
  readonly state: DesktopTrayState;
  readonly windowVisible: boolean;
  readonly onToggleWindow: () => void;
  readonly onDispatchMenuAction: (action: string) => void;
  readonly onQuit: () => void;
}

const initialTrayState: DesktopTrayState = {
  connectionStatus: "disconnected",
  activeProject: null,
  recentProjects: [],
};

function normalizeProject(project: DesktopTrayProject): DesktopTrayProject {
  return {
    id: project.id,
    environmentId: project.environmentId,
    name: project.name.trim() || project.cwd,
    cwd: project.cwd,
  };
}

export function normalizeTrayState(state: DesktopTrayState): DesktopTrayState {
  const seen = new Set<string>();
  const recentProjects: DesktopTrayProject[] = [];
  for (const project of state.recentProjects) {
    const normalized = normalizeProject(project);
    const key = `${normalized.environmentId}:${normalized.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    recentProjects.push(normalized);
    if (recentProjects.length >= MAX_RECENT_PROJECTS) {
      break;
    }
  }

  return {
    connectionStatus: state.connectionStatus,
    activeProject: state.activeProject ? normalizeProject(state.activeProject) : null,
    recentProjects,
  };
}

export function makeTrayTooltip(appName: string, state: DesktopTrayState): string {
  const activeProject = state.activeProject?.name ?? "No active project";
  return `${appName}\n${STATUS_LABEL[state.connectionStatus]} - ${activeProject}`;
}

function makeStatusImage(status: DesktopTrayConnectionStatus): Electron.NativeImage {
  const color = STATUS_COLOR[status];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#111827"/><path d="M9 10h14v3H9zM9 15h14v3H9zM9 20h9v3H9z" fill="#f9fafb"/><circle cx="24" cy="24" r="6" fill="${color}" stroke="#111827" stroke-width="2"/></svg>`;
  return Electron.nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
}

export function buildDesktopTrayMenuTemplate({
  state,
  windowVisible,
  onToggleWindow,
  onDispatchMenuAction,
  onQuit,
}: DesktopTrayMenuInput): Electron.MenuItemConstructorOptions[] {
  const recentProjects = state.recentProjects.slice(0, MAX_RECENT_PROJECTS);
  return [
    {
      label: windowVisible ? "Hide Window" : "Show Window",
      click: onToggleWindow,
    },
    {
      label: "New Chat",
      click: () => onDispatchMenuAction(DESKTOP_TRAY_NEW_CHAT_ACTION),
    },
    {
      label: "Open Recent Project",
      enabled: recentProjects.length > 0,
      submenu:
        recentProjects.length > 0
          ? recentProjects.map((project) => ({
              label: project.name,
              toolTip: project.cwd,
              click: () => onDispatchMenuAction(encodeDesktopTrayOpenProjectAction(project)),
            }))
          : [{ label: "No recent projects", enabled: false }],
    },
    { type: "separator" },
    {
      label: "Quit",
      click: onQuit,
    },
  ];
}

function isWindowVisible(window: Electron.BrowserWindow): boolean {
  return !window.isDestroyed() && window.isVisible();
}

const { logError: logTrayError } = DesktopObservability.makeComponentLogger("desktop-tray");

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const app = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const trayStateRef = yield* Ref.make(initialTrayState);
  const trayRef = yield* Ref.make<Option.Option<Electron.Tray>>(Option.none());
  const context = yield* Effect.context<DesktopTrayRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);
  const appName = yield* app.name;

  const runTrayEffect = <E>(effect: Effect.Effect<void, E, DesktopTrayRuntimeServices>) => {
    void runPromise(
      effect.pipe(
        Effect.catchCause((cause) =>
          logTrayError("desktop tray action failed", { cause: Cause.pretty(cause) }),
        ),
      ),
    );
  };

  const toggleWindow = Effect.gen(function* () {
    const currentWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(currentWindow) && isWindowVisible(currentWindow.value)) {
      currentWindow.value.hide();
      return;
    }
    yield* desktopWindow.revealOrCreateMain;
  }).pipe(Effect.withSpan("desktop.tray.toggleWindow"));

  const showWindow = desktopWindow.revealOrCreateMain.pipe(
    Effect.asVoid,
    Effect.withSpan("desktop.tray.showWindow"),
  );

  const quit = Effect.gen(function* () {
    const state = yield* DesktopState.DesktopState;
    yield* Ref.set(state.quitting, true);
    yield* app.quit;
  }).pipe(Effect.withSpan("desktop.tray.quit"));

  const syncTray = Effect.gen(function* () {
    const tray = yield* Ref.get(trayRef);
    if (Option.isNone(tray) || tray.value.isDestroyed()) {
      return;
    }

    const state = yield* Ref.get(trayStateRef);
    const currentWindow = yield* electronWindow.currentMainOrFirst;
    const windowVisible = Option.isSome(currentWindow) && isWindowVisible(currentWindow.value);
    tray.value.setImage(makeStatusImage(state.connectionStatus));
    tray.value.setToolTip(makeTrayTooltip(appName, state));
    tray.value.setContextMenu(
      Electron.Menu.buildFromTemplate(
        buildDesktopTrayMenuTemplate({
          state,
          windowVisible,
          onToggleWindow: () => runTrayEffect(toggleWindow),
          onDispatchMenuAction: (action) => runTrayEffect(desktopWindow.dispatchMenuAction(action)),
          onQuit: () => runTrayEffect(quit),
        }),
      ),
    );
  }).pipe(Effect.withSpan("desktop.tray.sync"));

  const configure = Effect.acquireRelease(
    Effect.sync(() => new Electron.Tray(makeStatusImage(initialTrayState.connectionStatus))).pipe(
      Effect.tap((tray) => Ref.set(trayRef, Option.some(tray))),
      Effect.tap((tray) =>
        Effect.sync(() => {
          tray.on("click", () => {
            runTrayEffect(environment.platform === "darwin" ? toggleWindow : showWindow);
          });
          tray.on("right-click", () => {
            tray.popUpContextMenu();
          });
        }),
      ),
      Effect.tap(() => syncTray),
    ),
    (tray) =>
      Effect.sync(() => {
        if (!tray.isDestroyed()) {
          tray.destroy();
        }
      }).pipe(Effect.andThen(Ref.set(trayRef, Option.none()))),
  ).pipe(Effect.asVoid, Effect.withSpan("desktop.tray.configure"));

  return DesktopTray.of({
    configure,
    updateState: Effect.fn("desktop.tray.updateState")(function* (state) {
      yield* Ref.set(trayStateRef, normalizeTrayState(state));
      yield* syncTray;
    }),
  });
});

export const layer = Layer.effect(DesktopTray, make);
