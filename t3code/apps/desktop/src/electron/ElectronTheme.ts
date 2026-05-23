import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
    readonly followSystemTheme: Effect.Effect<void>;
  readonly themeSource: Effect.Effect<"system" | "light" | "dark">;
  readonly setThemeSource: (source: "system" | "light" | "dark") => Effect.Effect<void>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
  setSource: (theme) =>
    Effect.suspend(() => {
      Electron.nativeTheme.themeSource = theme;
      return Effect.void;
    }),
    followSystemTheme: Effect.sync(() => {
    Electron.nativeTheme.themeSource = "system";
  }),
  themeSource: Effect.sync(() => Electron.nativeTheme.themeSource as "system" | "light" | "dark"),
  setThemeSource: (source) =>
    Effect.suspend(() => {
      Electron.nativeTheme.themeSource = source;
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
