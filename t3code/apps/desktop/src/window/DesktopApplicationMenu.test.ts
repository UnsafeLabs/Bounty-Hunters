import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

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

const readSubmenu = (
  template: readonly Electron.MenuItemConstructorOptions[],
  label: string,
): Electron.MenuItemConstructorOptions[] => {
  const menu = template.find((item) => item.label === label);
  assert.isDefined(menu);
  if (!Array.isArray(menu.submenu)) {
    throw new Error(`Expected ${label} menu submenu to be an array.`);
  }
  return menu.submenu;
};

const clickMenuItem = (
  submenu: readonly Electron.MenuItemConstructorOptions[],
  label: string,
): void => {
  const item = submenu.find((entry) => entry.label === label);
  assert.isDefined(item);
  if (typeof item.click !== "function") {
    throw new Error(`Expected ${label} menu item to have a click handler.`);
  }
  item.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
};

const makeElectronMenuLayer = (
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
) =>
  Layer.succeed(ElectronMenu.ElectronMenu, {
    setApplicationMenu: (template) =>
      Deferred.succeed(applicationMenuTemplate, template).pipe(Effect.asVoid),
    popupTemplate: () => Effect.void,
    showContextMenu: () => Effect.succeed(Option.none()),
  } satisfies ElectronMenu.ElectronMenuShape);

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
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const template = yield* Deferred.await(applicationMenuTemplate);
      const fileMenu = readSubmenu(template, "File");
      const settingsItem = fileMenu.find((item) => item.label === "Settings...");
      assert.isDefined(settingsItem);
      const settingsClick = settingsItem.click;
      if (typeof settingsClick !== "function") {
        throw new Error("Expected Settings menu item to have a click handler.");
      }

      settingsClick({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      assert.equal(yield* Deferred.await(selectedAction), "open-settings");
    }),
  );

  it.effect("installs Developer and Git menus with accelerators", () =>
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
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const template = yield* Deferred.await(applicationMenuTemplate);
      const developerMenu = readSubmenu(template, "Developer");
      const gitMenu = readSubmenu(template, "Git");

      assert.deepEqual(
        developerMenu
          .filter((item) => item.type !== "separator")
          .map((item) => [item.label, item.accelerator, item.role ?? null]),
        [
          ["Toggle Terminal", "Ctrl+`", null],
          ["Clear Terminal", "CmdOrCtrl+K", null],
          ["Restart Backend", "CmdOrCtrl+Shift+R", null],
          ["Open DevTools", "Ctrl+Shift+I", "toggleDevTools"],
        ],
      );
      assert.deepEqual(
        gitMenu.filter((item) => item.type !== "separator").map((item) => item.label),
        ["Stage All Changes", "Commit", "Push", "Pull", "Create Branch"],
      );
    }),
  );

  it.effect("routes Developer and Git menu clicks through DesktopWindow actions", () =>
    Effect.gen(function* () {
      const selectedActions = yield* Deferred.make<string[]>();
      const actions: string[] = [];
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      const desktopWindowLayer = Layer.succeed(DesktopWindow.DesktopWindow, {
        createMain: Effect.die("unexpected createMain"),
        ensureMain: Effect.die("unexpected ensureMain"),
        revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
        activate: Effect.void,
        createMainIfBackendReady: Effect.void,
        handleBackendReady: Effect.void,
        dispatchMenuAction: (action) =>
          Effect.sync(() => {
            actions.push(action);
            if (actions.length === 8) {
              Effect.runSync(Deferred.succeed(selectedActions, [...actions]));
            }
          }),
        syncAppearance: Effect.void,
      } satisfies DesktopWindow.DesktopWindowShape);

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuLayer(applicationMenuTemplate)),
            Layer.provideMerge(desktopWindowLayer),
            Layer.provideMerge(desktopUpdatesLayer),
            Layer.provideMerge(electronDialogLayer),
            Layer.provideMerge(electronAppLayer),
            Layer.provideMerge(
              DesktopEnvironment.layer(environmentInput).pipe(
                Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
              ),
            ),
          ),
        ),
      );

      const template = yield* Deferred.await(applicationMenuTemplate);
      const developerMenu = readSubmenu(template, "Developer");
      const gitMenu = readSubmenu(template, "Git");
      clickMenuItem(developerMenu, "Toggle Terminal");
      clickMenuItem(developerMenu, "Clear Terminal");
      clickMenuItem(developerMenu, "Restart Backend");
      clickMenuItem(gitMenu, "Stage All Changes");
      clickMenuItem(gitMenu, "Commit");
      clickMenuItem(gitMenu, "Push");
      clickMenuItem(gitMenu, "Pull");
      clickMenuItem(gitMenu, "Create Branch");

      assert.deepEqual(yield* Deferred.await(selectedActions), [
        "developer.toggle-terminal",
        "developer.clear-terminal",
        "developer.restart-backend",
        "git.stage-all-changes",
        "git.commit",
        "git.push",
        "git.pull",
        "git.create-branch",
      ]);
    }),
  );
});
