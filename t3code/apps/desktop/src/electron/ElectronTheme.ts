import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import * as Fs from "node:fs";
import * as Path from "node:path";

function resolveThemeStorePath(): string {
  return Path.join(Electron.app.getPath("userData"), "theme.json");
}

function readStoredTheme(): DesktopTheme {
  try {
    const raw = Fs.readFileSync(resolveThemeStorePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "theme" in parsed &&
      (parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system")
    ) {
      return parsed.theme as DesktopTheme;
    }
  } catch {
    // File doesn't exist or is corrupt — default to system
  }
  return "system";
}

function writeStoredTheme(theme: DesktopTheme): void {
  try {
    Fs.mkdirSync(Path.dirname(resolveThemeStorePath()), { recursive: true });
    Fs.writeFileSync(resolveThemeStorePath(), JSON.stringify({ theme }, null, 2), "utf-8");
  } catch {
    // Silently fail — persistence is best-effort for this layer
  }
}

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly getThemeSource: Effect.Effect<DesktopTheme>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
  getThemeSource: Effect.sync(() => {
    // Read from nativeTheme.themeSource (which Electron manages).
    // Electron's nativeTheme.themeSource is "system" | "light" | "dark".
    const source = Electron.nativeTheme.themeSource;
    if (source === "light" || source === "dark" || source === "system") {
      return source;
    }
    return "system";
  }),
  setSource: (theme) =>
    Effect.suspend(() => {
      Electron.nativeTheme.themeSource = theme;
      writeStoredTheme(theme);
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

export const initializeTheme = Effect.sync(() => {
  const stored = readStoredTheme();
  Electron.nativeTheme.themeSource = stored;
});

export const layer = Layer.succeed(ElectronTheme, make);
