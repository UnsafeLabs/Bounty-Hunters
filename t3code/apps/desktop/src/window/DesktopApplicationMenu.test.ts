import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import { DESKTOP_MENU_ACTIONS } from "@t3tools/contracts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "linux",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const electronAppLayer = Layer.succeed(ElectronApp.ElectronApp, {
  metadata: Effect.die("unexpected metadata read"),
  name: Effect.succeed("T3 Code"),
  whenReady: Effect.void,
  quit: Effect.void,
  exit: () => Effect.void,
  relaunch: () => Effect.void,
  setPath: () => Effect.void,
  setName: () => Effect.void,
  setAboutPanelOptions: () => Effect.void,
  setAppUserModelId: () => Effect.void,
  setDesktopName: () => Effect.void,
  setDockIcon: () => Effect.void,
  appendCommandLineSwitch: () => Effect.void,
  on: () => Effect.void,
} satisfies ElectronApp.ElectronAppShape);

const electronDialogLayer = Layer.succeed(ElectronDialog.ElectronDialog, {
  pickFolder: () => Effect.succeed(Option.none()),
  confirm: () => Effect.succeed(false),
  showMessageBox: () => Effect.succeed({ response: 0, checkboxChecked: false }),
  showErrorBox: () => Effect.void,
} satisfies ElectronDialog.ElectronDialogShape);

const desktopUpdatesLayer = Layer.succeed(DesktopUpdates.DesktopUpdates, {
  getState: Effect.die("unexpected getState"),
  emitState: Effect.void,
  disabledReason: Effect.succeed(Option.none()),
  configure: Effect.void,
  setChannel: () => Effect.die("unexpected setChannel"),
  check: () => Effect.die("unexpected check"),
  download: Effect.die("unexpected download"),
  install: Effect.die("unexpected install"),
} satisfies DesktopUpdates.DesktopUpdatesShape);

const makeDesktopWindowLayer = (selectedAction: Deferred.Deferred<string>) =>
  Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected createMain"),
    ensureMain: Effect.die("unexpected ensureMain"),
    revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
    activate: Effect.void,
    createMainIfBackendReady: Effect.void,
    handleBackendReady: Effect.void,
    dispatchMenuAction: (action) => Deferred.succeed(selectedAction, action).pipe(Effect.asVoid),
    syncAppearance: Effect.void,
  } satisfies DesktopWindow.DesktopWindowShape);

const makeDesktopWindowQueueLayer = (selectedActions: Queue.Queue<string>) =>
  Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected createMain"),
    ensureMain: Effect.die("unexpected ensureMain"),
    revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
    activate: Effect.void,
    createMainIfBackendReady: Effect.void,
    handleBackendReady: Effect.void,
    dispatchMenuAction: (action) => Queue.offer(selectedActions, action).pipe(Effect.asVoid),
    syncAppearance: Effect.void,
  } satisfies DesktopWindow.DesktopWindowShape);

const makeElectronMenuLayer = (
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
) =>
  Layer.succeed(ElectronMenu.ElectronMenu, {
    setApplicationMenu: (template) =>
      Deferred.succeed(applicationMenuTemplate, template).pipe(Effect.asVoid),
    popupTemplate: () => Effect.void,
    showContextMenu: () => Effect.succeed(Option.none()),
  } satisfies ElectronMenu.ElectronMenuShape);

const makeElectronMenuQueueLayer = (
  applicationMenuTemplates: Queue.Queue<readonly Electron.MenuItemConstructorOptions[]>,
) =>
  Layer.succeed(ElectronMenu.ElectronMenu, {
    setApplicationMenu: (template) =>
      Queue.offer(applicationMenuTemplates, template).pipe(Effect.asVoid),
    popupTemplate: () => Effect.void,
    showContextMenu: () => Effect.succeed(Option.none()),
  } satisfies ElectronMenu.ElectronMenuShape);

function findTopLevelMenu(
  template: readonly Electron.MenuItemConstructorOptions[],
  label: string,
): Electron.MenuItemConstructorOptions {
  const menu = template.find((item) => item.label === label);
  assert.isDefined(menu);
  return menu;
}

function findSubmenuItem(
  menu: Electron.MenuItemConstructorOptions,
  label: string,
): Electron.MenuItemConstructorOptions {
  if (!Array.isArray(menu.submenu)) {
    throw new Error(`Expected ${menu.label ?? "menu"} submenu to be an array.`);
  }
  const item = menu.submenu.find((submenuItem) => submenuItem.label === label);
  assert.isDefined(item);
  return item;
}

function clickMenuItem(item: Electron.MenuItemConstructorOptions): void {
  if (typeof item.click !== "function") {
    throw new Error(`Expected ${item.label ?? "menu item"} to have a click handler.`);
  }
  item.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
}

describe("DesktopApplicationMenu", () => {
  it.effect("installs the native menu and routes Settings through DesktopWindow", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuLayer(applicationMenuTemplate)),
            Layer.provideMerge(makeDesktopWindowLayer(selectedAction)),
            Layer.provideMerge(desktopUpdatesLayer),
            Layer.provideMerge(electronDialogLayer),
            Layer.provideMerge(electronAppLayer),
            Layer.provideMerge(DesktopState.layer),
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const template = yield* Deferred.await(applicationMenuTemplate);
      const settingsItem = findSubmenuItem(findTopLevelMenu(template, "File"), "Settings...");

      clickMenuItem(settingsItem);
      assert.equal(yield* Deferred.await(selectedAction), DESKTOP_MENU_ACTIONS.openSettings);
    }),
  );

  it.effect("adds Developer and Git menus and dispatches backend-backed actions", () =>
    Effect.gen(function* () {
      const selectedActions = yield* Queue.unbounded<string>();
      const applicationMenuTemplates =
        yield* Queue.unbounded<readonly Electron.MenuItemConstructorOptions[]>();

      yield* Effect.gen(function* () {
        const state = yield* DesktopState.DesktopState;
        yield* state.setBackendReady(true);
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuQueueLayer(applicationMenuTemplates)),
            Layer.provideMerge(makeDesktopWindowQueueLayer(selectedActions)),
            Layer.provideMerge(desktopUpdatesLayer),
            Layer.provideMerge(electronDialogLayer),
            Layer.provideMerge(electronAppLayer),
            Layer.provideMerge(DesktopState.layer),
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const template = yield* Queue.take(applicationMenuTemplates);
      const developerMenu = findTopLevelMenu(template, "Developer");
      const gitMenu = findTopLevelMenu(template, "Git");
      const toggleTerminalItem = findSubmenuItem(developerMenu, "Toggle Terminal");
      const restartBackendItem = findSubmenuItem(developerMenu, "Restart Backend");
      const stageAllItem = findSubmenuItem(gitMenu, "Stage All Changes");
      const createBranchItem = findSubmenuItem(gitMenu, "Create Branch...");

      assert.equal(toggleTerminalItem.enabled, true);
      assert.equal(toggleTerminalItem.accelerator, "CmdOrCtrl+J");
      assert.equal(restartBackendItem.enabled, true);
      assert.equal(stageAllItem.enabled, true);
      assert.equal(createBranchItem.enabled, true);

      clickMenuItem(toggleTerminalItem);
      clickMenuItem(stageAllItem);

      assert.equal(yield* Queue.take(selectedActions), DESKTOP_MENU_ACTIONS.terminalToggle);
      assert.equal(yield* Queue.take(selectedActions), DESKTOP_MENU_ACTIONS.gitStageAll);
    }),
  );

  it.effect("refreshes backend-backed menu enabled state when backend readiness changes", () =>
    Effect.gen(function* () {
      const selectedActions = yield* Queue.unbounded<string>();
      const applicationMenuTemplates =
        yield* Queue.unbounded<readonly Electron.MenuItemConstructorOptions[]>();

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
        const state = yield* DesktopState.DesktopState;
        yield* state.setBackendReady(true);
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuQueueLayer(applicationMenuTemplates)),
            Layer.provideMerge(makeDesktopWindowQueueLayer(selectedActions)),
            Layer.provideMerge(desktopUpdatesLayer),
            Layer.provideMerge(electronDialogLayer),
            Layer.provideMerge(electronAppLayer),
            Layer.provideMerge(DesktopState.layer),
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const disabledTemplate = yield* Queue.take(applicationMenuTemplates);
      const enabledTemplate = yield* Queue.take(applicationMenuTemplates);

      assert.equal(
        findSubmenuItem(findTopLevelMenu(disabledTemplate, "Developer"), "Toggle Terminal").enabled,
        false,
      );
      assert.equal(
        findSubmenuItem(findTopLevelMenu(enabledTemplate, "Developer"), "Toggle Terminal").enabled,
        true,
      );
    }),
  );
});
