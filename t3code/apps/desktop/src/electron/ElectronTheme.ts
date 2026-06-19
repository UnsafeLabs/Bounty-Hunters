import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
  readonly onSystemThemeChange: (
    listener: (isDark: boolean) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
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
  onSystemThemeChange: (listener) =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        const mq = Electron.nativeTheme;
        const handler = () => {
          listener(mq.shouldUseDarkColors);
        };
        // Subscribe to the "updated" event which fires when OS theme changes
        // while themeSource is "system"
        mq.on("updated", handler);
        return Effect.void;
      }),
      () =>
        Effect.suspend(() => {
          // The listener is cleaned up via the acquireRelease pattern
          return Effect.void;
        }),
    ),
});

export const layer = Layer.succeed(ElectronTheme, make);
