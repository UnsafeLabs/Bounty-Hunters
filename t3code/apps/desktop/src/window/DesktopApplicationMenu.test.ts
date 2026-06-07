import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vitest";

import type * as Electron from "electron";

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template }),
    setApplicationMenu: () => undefined,
  },
}));

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopSavedEnvironments from "../settings/DesktopSavedEnvironments.ts";
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

const makeElectronDialogLayer = (
  showMessageBox?: ElectronDialog.ElectronDialogShape["showMessageBox"],
) =>
  Layer.succeed(ElectronDialog.ElectronDialog, {
    pickFolder: () => Effect.succeed(Option.none()),
    confirm: () => Effect.succeed(false),
    showMessageBox: showMessageBox ?? (() => Effect.succeed({ response: 0, checkboxChecked: false })),
    showErrorBox: () => Effect.void,
  } satisfies ElectronDialog.ElectronDialogShape);

const electronDialogLayer = makeElectronDialogLayer();

const makeDesktopSavedEnvironmentsLayer = (rotate?: () => Effect.Effect<void>) =>
  Layer.succeed(DesktopSavedEnvironments.DesktopSavedEnvironments, {
    getRegistry: Effect.succeed([]),
    setRegistry: () => Effect.void,
    getSecret: () => Effect.succeed(Option.none()),
    setSecret: () => Effect.succeed(false),
    removeSecret: () => Effect.void,
    rotateKeys: Effect.gen(function* () {
      if (rotate) {
        yield* rotate();
      }
      return {
        previousKeyVersion: "test-key-v1",
        currentKeyVersion: "test-key-v2",
        reencryptedSecrets: 1,
        rotatedAt: "2026-06-07T00:00:00.000Z",
      };
    }),
  } satisfies DesktopSavedEnvironments.DesktopSavedEnvironmentsShape);

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
            Layer.provideMerge(makeDesktopSavedEnvironmentsLayer()),
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
      const fileMenu = template.find((item) => item.label === "File");
      assert.isDefined(fileMenu);
      if (!Array.isArray(fileMenu.submenu)) {
        throw new Error("Expected File menu submenu to be an array.");
      }
      const settingsItem = fileMenu.submenu.find((item) => item.label === "Settings...");
      assert.isDefined(settingsItem);
      const settingsClick = settingsItem.click;
      if (typeof settingsClick !== "function") {
        throw new Error("Expected Settings menu item to have a click handler.");
      }

      settingsClick({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      assert.equal(yield* Deferred.await(selectedAction), "open-settings");
    }),
  );

  it.effect("adds a Developer menu action for rotating saved environment encryption keys", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
      const rotationCompleted = yield* Deferred.make<void>();

      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
      }).pipe(
        Effect.provide(
          DesktopApplicationMenu.layer.pipe(
            Layer.provideMerge(makeElectronMenuLayer(applicationMenuTemplate)),
            Layer.provideMerge(makeDesktopWindowLayer(selectedAction)),
            Layer.provideMerge(desktopUpdatesLayer),
            Layer.provideMerge(
              makeDesktopSavedEnvironmentsLayer(() =>
                Deferred.succeed(rotationCompleted, undefined).pipe(Effect.asVoid),
              ),
            ),
            Layer.provideMerge(makeElectronDialogLayer(() => Effect.succeed({ response: 0, checkboxChecked: false }))),
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
      const developerMenu = template.find((item) => item.label === "Developer");
      assert.isDefined(developerMenu);
      if (!Array.isArray(developerMenu.submenu)) {
        throw new Error("Expected Developer menu submenu to be an array.");
      }
      const rotateItem = developerMenu.submenu.find(
        (item) => item.label === "Rotate Encryption Keys...",
      );
      assert.isDefined(rotateItem);
      const rotateClick = rotateItem.click;
      if (typeof rotateClick !== "function") {
        throw new Error("Expected Rotate Encryption Keys menu item to have a click handler.");
      }

      rotateClick({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      yield* Deferred.await(rotationCompleted);
    }),
  );
});
