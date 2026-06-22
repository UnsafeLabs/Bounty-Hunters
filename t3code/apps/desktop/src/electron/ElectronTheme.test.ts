import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vitest";

const { onMock, removeListenerMock, themeState } = vi.hoisted(() => ({
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
  themeState: {
    shouldUseDarkColors: true,
    themeSource: "system" as string,
  },
}));

vi.mock("electron", () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return themeState.shouldUseDarkColors;
    },
    get themeSource() {
      return themeState.themeSource;
    },
    set themeSource(value: string) {
      themeState.themeSource = value;
    },
    on: onMock,
    removeListener: removeListenerMock,
  },
}));

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronTheme from "./ElectronTheme.ts";

function makeEnvironmentLayer(baseDir: string) {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "0.0.17",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
}

const withTheme = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | ElectronTheme.ElectronTheme | DesktopEnvironment.DesktopEnvironment
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-theme-test-",
    });
    return yield* effect.pipe(
      Effect.provide(
        ElectronTheme.layer.pipe(
          Layer.provideMerge(makeEnvironmentLayer(baseDir)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("ElectronTheme", () => {
  beforeEach(() => {
    onMock.mockClear();
    removeListenerMock.mockClear();
    themeState.shouldUseDarkColors = true;
    themeState.themeSource = "system";
  });

  it.effect("scopes native theme update listeners", () =>
    Effect.gen(function* () {
      const listener = vi.fn();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const electronTheme = yield* ElectronTheme.ElectronTheme;
          yield* electronTheme.onUpdated(listener);
        }),
      );

      assert.deepEqual(onMock.mock.calls, [["updated", listener]]);
      assert.deepEqual(removeListenerMock.mock.calls, [["updated", listener]]);
    }).pipe(Effect.provide(ElectronTheme.layerTest())),
  );

  it.effect("defaults to system theme when no persisted file exists", () =>
    withTheme(
      Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;
        const source = yield* electronTheme.getSource;
        assert.equal(source, "system");
      }),
    ),
  );

  it.effect("persists theme choice and restores on reload", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-theme-persist-test-",
      });

      // First session: set theme to dark
      yield* Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;
        yield* electronTheme.setSource("dark");
        const source = yield* electronTheme.getSource;
        assert.equal(source, "dark");
      }).pipe(
        Effect.provide(
          ElectronTheme.layer.pipe(
            Layer.provideMerge(makeEnvironmentLayer(baseDir)),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      );

      // Second session: should load persisted dark theme
      yield* Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;
        const source = yield* electronTheme.getSource;
        assert.equal(source, "dark");
      }).pipe(
        Effect.provide(
          ElectronTheme.layer.pipe(
            Layer.provideMerge(makeEnvironmentLayer(baseDir)),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("setSource updates nativeTheme.themeSource", () =>
    withTheme(
      Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;
        yield* electronTheme.setSource("light");
        assert.equal(themeState.themeSource, "light");
        assert.equal(yield* electronTheme.getSource, "light");
      }),
    ),
  );

  it.effect("setSource writes theme preference to disk", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-theme-write-test-",
      });

      yield* Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;
        yield* electronTheme.setSource("dark");
      }).pipe(
        Effect.provide(
          ElectronTheme.layer.pipe(
            Layer.provideMerge(makeEnvironmentLayer(baseDir)),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      );

      // Verify the file was written
      const themeFile = yield* fileSystem
        .readFileString(`${baseDir}/.t3/userdata/theme.json`)
        .pipe(Effect.option);
      assert.isTrue(themeFile._tag === "Some");
      if (themeFile._tag === "Some") {
        const parsed = JSON.parse(themeFile.value) as { theme: string };
        assert.equal(parsed.theme, "dark");
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("falls back to system when persisted theme file is malformed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-theme-malformed-test-",
      });

      // Write a malformed theme file
      yield* Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          `${environment.stateDir}/theme.json`,
          "{not-json",
        );
      }).pipe(
        Effect.provide(makeEnvironmentLayer(baseDir)),
        Effect.provide(NodeServices.layer),
      );

      // Should fall back to system
      yield* Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;
        const source = yield* electronTheme.getSource;
        assert.equal(source, "system");
      }).pipe(
        Effect.provide(
          ElectronTheme.layer.pipe(
            Layer.provideMerge(makeEnvironmentLayer(baseDir)),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("system mode follows OS dark preference in real-time", () =>
    withTheme(
      Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;

        // Set to system mode
        yield* electronTheme.setSource("system");
        assert.equal(themeState.themeSource, "system");

        // Simulate OS switching to dark
        themeState.shouldUseDarkColors = true;
        let isDark = yield* electronTheme.shouldUseDarkColors;
        assert.isTrue(isDark);

        // Simulate OS switching to light
        themeState.shouldUseDarkColors = false;
        isDark = yield* electronTheme.shouldUseDarkColors;
        assert.isFalse(isDark);
      }),
    ),
  );

  it.effect("all three theme options are supported", () =>
    withTheme(
      Effect.gen(function* () {
        const electronTheme = yield* ElectronTheme.ElectronTheme;

        yield* electronTheme.setSource("light");
        assert.equal(yield* electronTheme.getSource, "light");
        assert.equal(themeState.themeSource, "light");

        yield* electronTheme.setSource("dark");
        assert.equal(yield* electronTheme.getSource, "dark");
        assert.equal(themeState.themeSource, "dark");

        yield* electronTheme.setSource("system");
        assert.equal(yield* electronTheme.getSource, "system");
        assert.equal(themeState.themeSource, "system");
      }),
    ),
  );
});
