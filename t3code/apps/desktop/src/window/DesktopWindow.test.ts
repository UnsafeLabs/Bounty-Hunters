import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";
import { vi } from "vitest";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

function makeFakeBrowserWindow() {
  const webContents = {
    copyImageAt: vi.fn(),
    isLoadingMainFrame: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    openDevTools: vi.fn(),
    replaceMisspelling: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  const window = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    show: vi.fn(),
    webContents,
  };

  return {
    window: window as unknown as Electron.BrowserWindow,
    loadURL: window.loadURL,
    openDevTools: webContents.openDevTools,
  };
}

const desktopAssetsLayer = Layer.succeed(DesktopAssets.DesktopAssets, {
  iconPaths: Effect.succeed({
    ico: Option.none<string>(),
    icns: Option.none<string>(),
    png: Option.none<string>(),
  }),
  resolveResourcePath: () => Effect.succeed(Option.none<string>()),
} satisfies DesktopAssets.DesktopAssetsShape);

const desktopServerExposureLayer = Layer.succeed(DesktopServerExposure.DesktopServerExposure, {
  getState: Effect.die("unexpected getState"),
  backendConfig: Effect.succeed({
    port: 3773,
    bindHost: "127.0.0.1",
    httpBaseUrl: new URL("http://127.0.0.1:3773"),
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  }),
  configureFromSettings: () => Effect.die("unexpected configureFromSettings"),
  setMode: () => Effect.die("unexpected setMode"),
  setTailscaleServeEnabled: () => Effect.die("unexpected setTailscaleServeEnabled"),
  getAdvertisedEndpoints: Effect.die("unexpected getAdvertisedEndpoints"),
} satisfies DesktopServerExposure.DesktopServerExposureShape);

const electronMenuLayer = Layer.succeed(ElectronMenu.ElectronMenu, {
  setApplicationMenu: () => Effect.void,
  popupTemplate: () => Effect.void,
  showContextMenu: () => Effect.succeed(Option.none()),
} satisfies ElectronMenu.ElectronMenuShape);

const electronShellLayer = Layer.succeed(ElectronShell.ElectronShell, {
  openExternal: () => Effect.succeed(true),
  copyText: () => Effect.void,
} satisfies ElectronShell.ElectronShellShape);

const electronDialogLayer = Layer.succeed(ElectronDialog.ElectronDialog, {
  pickFolder: () => Effect.succeed(Option.none<string>()),
  confirm: () => Effect.succeed(false),
  showMessageBox: () => Effect.succeed({ response: 0, checkboxChecked: false }),
  showErrorBox: () => Effect.void,
} satisfies ElectronDialog.ElectronDialogShape);

const electronThemeLayer = Layer.succeed(ElectronTheme.ElectronTheme, {
  shouldUseDarkColors: Effect.succeed(false),
  setSource: () => Effect.void,
  onUpdated: () => Effect.void,
} satisfies ElectronTheme.ElectronThemeShape);

const desktopEnvironmentLayer = DesktopEnvironment.layer(environmentInput).pipe(
  Layer.provide(
    Layer.mergeAll(
      NodeServices.layer,
      DesktopConfig.layerTest({
        T3CODE_PORT: "3773",
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
      }),
    ),
  ),
);

function makeTestLayer(input: {
  readonly window: Electron.BrowserWindow;
  readonly createCount: Ref.Ref<number>;
  readonly mainWindow: Ref.Ref<Option.Option<Electron.BrowserWindow>>;
}) {
  const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    create: () => Ref.update(input.createCount, (count) => count + 1).pipe(Effect.as(input.window)),
    main: Ref.get(input.mainWindow),
    currentMainOrFirst: Ref.get(input.mainWindow),
    focusedMainOrFirst: Ref.get(input.mainWindow),
    setMain: (window) => Ref.set(input.mainWindow, Option.some(window)),
    clearMain: () => Ref.set(input.mainWindow, Option.none()),
    reveal: () => Effect.void,
    sendAll: () => Effect.void,
    destroyAll: Effect.void,
    syncAllAppearance: (sync) => sync(input.window),
  } satisfies ElectronWindow.ElectronWindowShape);

  return DesktopWindow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        desktopAssetsLayer,
        desktopEnvironmentLayer,
        desktopServerExposureLayer,
        DesktopState.layer,
        electronDialogLayer,
        electronMenuLayer,
        electronShellLayer,
        electronThemeLayer,
        electronWindowLayer,
      ),
    ),
  );
}

describe("DesktopWindow", () => {
  it.effect("does not open a development window until the backend is ready", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.activate;
        assert.equal(yield* Ref.get(createCount), 0);

        yield* desktopWindow.handleBackendReady;
        assert.equal(yield* Ref.get(createCount), 1);
        assert.deepEqual(fakeWindow.loadURL.mock.calls[0], ["http://127.0.0.1:5733/"]);
        assert.equal(fakeWindow.openDevTools.mock.calls.length, 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("notifies a non-blocking backend restart and maps failure choices", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const dialogCalls = yield* Ref.make<Array<string>>([]);
      const dialogResponse = yield* Ref.make(0);

      const recordingDialogLayer = Layer.succeed(ElectronDialog.ElectronDialog, {
        pickFolder: () => Effect.succeed(Option.none<string>()),
        confirm: () => Effect.succeed(false),
        showMessageBox: (options) =>
          Ref.update(dialogCalls, (calls) => [...calls, options.message]).pipe(
            Effect.as({ response: 0, checkboxChecked: false }),
            Effect.flatMap((result) =>
              Ref.get(dialogResponse).pipe(Effect.map((response) => ({ ...result, response }))),
            ),
          ),
        showErrorBox: () => Effect.void,
      } satisfies ElectronDialog.ElectronDialogShape);

      const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
        create: () =>
          Ref.update(createCount, (count) => count + 1).pipe(Effect.as(fakeWindow.window)),
        main: Ref.get(mainWindow),
        currentMainOrFirst: Ref.get(mainWindow),
        focusedMainOrFirst: Ref.get(mainWindow),
        setMain: (window) => Ref.set(mainWindow, Option.some(window)),
        clearMain: () => Ref.set(mainWindow, Option.none()),
        reveal: () => Effect.void,
        sendAll: () => Effect.void,
        destroyAll: Effect.void,
        syncAllAppearance: (sync) => sync(fakeWindow.window),
      } satisfies ElectronWindow.ElectronWindowShape);

      const layer = DesktopWindow.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            desktopAssetsLayer,
            desktopEnvironmentLayer,
            desktopServerExposureLayer,
            DesktopState.layer,
            recordingDialogLayer,
            electronMenuLayer,
            electronShellLayer,
            electronThemeLayer,
            electronWindowLayer,
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;

        yield* desktopWindow.notifyBackendRestarting({ attempt: 2 });
        assert.deepEqual(yield* Ref.get(dialogCalls), ["Backend is restarting"]);

        yield* Ref.set(dialogResponse, 0);
        assert.equal(yield* desktopWindow.promptBackendFailure({ restartAttempts: 3 }), "retry");

        yield* Ref.set(dialogResponse, 1);
        assert.equal(yield* desktopWindow.promptBackendFailure({ restartAttempts: 3 }), "quit");
      }).pipe(Effect.provide(layer));
    }),
  );
});
