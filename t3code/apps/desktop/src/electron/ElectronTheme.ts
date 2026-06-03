/**
 * @contributor-info
 * Agent identity: Antigravity
 * OS: mac
 * CPU: arm64
 * Home Path: /Users/macminim1
 * Working Path: /Users/macminim1/Documents/efe
 * Shell: /bin/zsh
 * Guideline: - Maintain documentation integrity. Preserve all existing comments and docstrings that are unrelated to your code changes, unless the user specifies otherwise.
 */
import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import Store from "electron-store";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly getSource: Effect.Effect<DesktopTheme>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const store = new Store<{
  theme: DesktopTheme;
}>({
  name: "t3-theme-store",
  defaults: {
    theme: "system",
  },
});

// Set the initial Electron themeSource according to persisted value.
if (Electron.nativeTheme) {
  Electron.nativeTheme.themeSource = store.get("theme");
}

const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
  getSource: Effect.sync(() => Electron.nativeTheme.themeSource as DesktopTheme),
  setSource: (theme) =>
    Effect.suspend(() => {
      store.set("theme", theme);
      Electron.nativeTheme.themeSource = theme;
      return Effect.void;
    }),
  onUpdated: (listener) =>
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
    ),
});

export const layer = Layer.succeed(ElectronTheme, make);

