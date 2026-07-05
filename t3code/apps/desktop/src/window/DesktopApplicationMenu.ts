import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import type * as Electron from "electron";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopBackendManager from "../backend/DesktopBackendManager.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export interface DesktopApplicationMenuShape {
  readonly configure: Effect.Effect<void, never, Scope.Scope>;
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  DesktopApplicationMenuShape
>()("t3/desktop/ApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow
  | DesktopBackendManager.DesktopBackendManager
  | DesktopState.DesktopState
  | ElectronDialog.ElectronDialog;

const BACKEND_MENU_REFRESH_INTERVAL = Duration.seconds(1);

const { logInfo: logUpdaterInfo } = DesktopObservability.makeComponentLogger("desktop-updater");

const { logError: logMenuError } = DesktopObservability.makeComponentLogger("desktop-menu");

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action);
});

const checkForUpdatesFromMenu: Effect.Effect<
  void,
  never,
  DesktopUpdates.DesktopUpdates | ElectronDialog.ElectronDialog
> = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* updates.check("menu");
  const updateState = result.state;

  if (updateState.status === "up-to-date") {
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `T3 Code ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}).pipe(Effect.withSpan("desktop.menu.checkForUpdates"));

const restartBackendFromMenu: Effect.Effect<
  void,
  never,
  DesktopBackendManager.DesktopBackendManager
> = Effect.gen(function* () {
  const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
  yield* backendManager.stop({ timeout: Duration.seconds(2) });
  yield* backendManager.start;
}).pipe(Effect.withSpan("desktop.menu.restartBackend"));

const handleCheckForUpdatesMenuClick: Effect.Effect<
  void,
  DesktopWindow.DesktopWindowError,
  DesktopUpdates.DesktopUpdates | ElectronDialog.ElectronDialog | DesktopWindow.DesktopWindow
> = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const disabledReason = yield* updates.disabledReason;
  if (Option.isSome(disabledReason)) {
    yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
      disabledReason: disabledReason.value,
    });
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason.value,
      buttons: ["OK"],
    });
    return;
  }

  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.ensureMain;
  yield* checkForUpdatesFromMenu;
}).pipe(Effect.withSpan("desktop.menu.handleCheckForUpdatesClick"));

const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopState = yield* DesktopState.DesktopState;
  const appName = yield* electronApp.name;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);
  const lastBackendReady = yield* Ref.make<boolean | null>(null);

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) =>
          logMenuError("desktop menu action failed", {
            action,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );
  };

  const checkForUpdatesClick = () => {
    runMenuEffect("check-for-updates", handleCheckForUpdatesMenuClick);
  };
  const dispatchRendererMenuActionClick = (action: string) => () => {
    runMenuEffect(action, dispatchMenuAction(action));
  };
  const restartBackendClick = () => {
    runMenuEffect("restart-backend", restartBackendFromMenu);
  };

  const buildTemplate = (backendReady: boolean): Electron.MenuItemConstructorOptions[] => {
    const backendActionEnabled = backendReady;
    const settingsClick = dispatchRendererMenuActionClick("open-settings");
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: appName,
        submenu: [
          { role: "about" },
          {
            label: "Check for Updates...",
            click: checkForUpdatesClick,
          },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: "File",
        submenu: [
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          { role: environment.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
          { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Developer",
        submenu: [
          {
            label: "Toggle Terminal",
            accelerator: "CmdOrCtrl+`",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("terminal.toggle"),
          },
          {
            label: "Clear Terminal",
            accelerator: "CmdOrCtrl+Shift+K",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("terminal.clear"),
          },
          {
            label: "Restart Backend",
            accelerator: "CmdOrCtrl+Shift+R",
            click: restartBackendClick,
          },
          { type: "separator" },
          {
            label: "Open DevTools",
            accelerator: environment.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
            role: "toggleDevTools",
          },
        ],
      },
      {
        label: "Git",
        submenu: [
          {
            label: "Stage All Changes",
            accelerator: "CmdOrCtrl+Shift+A",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("git.stageAll"),
          },
          {
            label: "Commit",
            accelerator: "CmdOrCtrl+Enter",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("git.commit"),
          },
          {
            label: "Push",
            accelerator: "CmdOrCtrl+Shift+P",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("git.push"),
          },
          {
            label: "Pull",
            accelerator: "CmdOrCtrl+Shift+U",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("git.pull"),
          },
          {
            label: "Create Branch",
            accelerator: "CmdOrCtrl+Shift+B",
            enabled: backendActionEnabled,
            click: dispatchRendererMenuActionClick("git.createBranch"),
          },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Check for Updates...",
            click: checkForUpdatesClick,
          },
        ],
      },
    );

    return template;
  };

  const applyMenu = Effect.gen(function* () {
    const backendReady = yield* Ref.get(desktopState.backendReady);
    yield* Ref.set(lastBackendReady, backendReady);
    yield* electronMenu.setApplicationMenu(buildTemplate(backendReady));
  });

  const refreshBackendMenuState = Effect.gen(function* () {
    const backendReady = yield* Ref.get(desktopState.backendReady);
    const previousBackendReady = yield* Ref.get(lastBackendReady);
    if (previousBackendReady === backendReady) {
      return;
    }
    yield* applyMenu;
  });

  const configure = Effect.gen(function* () {
    yield* applyMenu;
    yield* Effect.forever(
      refreshBackendMenuState.pipe(
        Effect.delay(BACKEND_MENU_REFRESH_INTERVAL),
        Effect.catchCause((cause) =>
          logMenuError("desktop menu backend readiness refresh failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    ).pipe(Effect.forkScoped, Effect.asVoid);
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);
