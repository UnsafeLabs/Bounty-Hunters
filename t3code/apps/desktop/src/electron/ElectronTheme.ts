import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import Store from "electron-store";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
  readonly getSource: Effect.Effect<DesktopTheme>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
  readonly initialize: Effect.Effect<void>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const THEME_STORAGE_KEY = "desktop-theme";
const THEME_IPC_CHANNEL = "theme:changed";

const make = Effect.gen(function* () {
  const currentThemeRef = yield* Ref.make<DesktopTheme>("system");
  const store = new Store();

  // Load persisted theme or default to system
  const loadPersistedTheme = Effect.sync(() => {
    const persisted = store.get(THEME_STORAGE_KEY) as DesktopTheme | undefined;
    return persisted ?? "system";
  });

  // Persist theme choice
  const persistTheme = (theme: DesktopTheme) =>
    Effect.sync(() => {
      store.set(THEME_STORAGE_KEY, theme);
    });

  // Send theme change to renderer via IPC
  const notifyRenderer = (theme: DesktopTheme, isDark: boolean) =>
    Effect.sync(() => {
      const windows = Electron.BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send(THEME_IPC_CHANNEL, { theme, isDark });
      }
    });

  // Handle system theme changes
  const handleSystemThemeChange = Effect.fn("electron.theme.handleSystemThemeChange")(function* () {
    const currentTheme = yield* Ref.get(currentThemeRef);
    if (currentTheme === "system") {
      const isDark = Electron.nativeTheme.shouldUseDarkColors;
      yield* notifyRenderer("system", isDark);
    }
  });

  const shouldUseDarkColors = Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors);

  const setSource = (theme: DesktopTheme) =>
    Effect.gen(function* () {
      Electron.nativeTheme.themeSource = theme === "system" ? "system" : theme;
      yield* Ref.set(currentThemeRef, theme);
      yield* persistTheme(theme);

      const isDark = Electron.nativeTheme.shouldUseDarkColors;
      yield* notifyRenderer(theme, isDark);
    });

  const getSource = Ref.get(currentThemeRef);

  const onUpdated = (listener: () => void) =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        Electron.nativeTheme.on("updated", listener);
        return Effect.void;
      }),
      () =>
        Effect.suspend(() => {
          Electron.nativeTheme.removeListener("updated", listener);
          return Effect.void;
        }),
    );

  const initialize = Effect.gen(function* () {
    // Load persisted theme
    const persistedTheme = yield* loadPersistedTheme;
    yield* Ref.set(currentThemeRef, persistedTheme);

    // Apply theme
    Electron.nativeTheme.themeSource = persistedTheme === "system" ? "system" : persistedTheme;

    // Listen for system theme changes
    yield* onUpdated(() => {
      void Effect.runPromise(handleSystemThemeChange);
    });

    // Initial notification to renderer
    const isDark = Electron.nativeTheme.shouldUseDarkColors;
    yield* notifyRenderer(persistedTheme, isDark);
  });

  return ElectronTheme.of({
    shouldUseDarkColors,
    setSource,
    getSource,
    onUpdated,
    initialize,
  });
});

export const layer = Layer.effect(ElectronTheme, make);
