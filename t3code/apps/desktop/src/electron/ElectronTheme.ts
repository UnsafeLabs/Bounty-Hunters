import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly getSource: Effect.Effect<DesktopTheme>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const VALID_THEMES: ReadonlySet<string> = new Set(["light", "dark", "system"]);

function normalizeThemeSource(raw: unknown): DesktopTheme {
  if (typeof raw === "string" && VALID_THEMES.has(raw)) {
    return raw as DesktopTheme;
  }
  return "system";
}

interface ThemeDocument {
  readonly theme?: string;
}

function parseThemeFile(raw: string): DesktopTheme {
  try {
    const parsed = JSON.parse(raw) as ThemeDocument;
    return normalizeThemeSource(parsed.theme);
  } catch {
    return "system";
  }
}

function readPersistedTheme(
  fileSystem: FileSystem.FileSystem,
  themePath: string,
): Effect.Effect<DesktopTheme> {
  return fileSystem.readFileString(themePath).pipe(
    Effect.option,
    Effect.map(
      Option.match({
        onNone: () => "system" as DesktopTheme,
        onSome: parseThemeFile,
      }),
    ),
  );
}

function writePersistedTheme(
  fileSystem: FileSystem.FileSystem,
  pathModule: Path.Path,
  themePath: string,
  theme: DesktopTheme,
): Effect.Effect<void> {
  const directory = pathModule.dirname(themePath);
  const content = JSON.stringify({ theme }, null, 2) + "\n";
  return Effect.gen(function* () {
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(themePath, content);
  });
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathModule = yield* Path.Path;

  const themePath = pathModule.join(environment.stateDir, "theme.json");

  // Read persisted theme on startup and apply it
  const persistedTheme = yield* readPersistedTheme(fileSystem, themePath);
  Electron.nativeTheme.themeSource = persistedTheme;

  const sourceRef = yield* Ref.make<DesktopTheme>(persistedTheme);

  return ElectronTheme.of({
    shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
    getSource: Ref.get(sourceRef),
    setSource: (theme) =>
      Effect.gen(function* () {
        Electron.nativeTheme.themeSource = theme;
        yield* Ref.set(sourceRef, theme);
        yield* writePersistedTheme(fileSystem, pathModule, themePath, theme);
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
});

export const layer = Layer.effect(ElectronTheme, make);

export const layerTest = (
  initialTheme: DesktopTheme = "system",
) =>
  Layer.effect(
    ElectronTheme,
    Effect.gen(function* () {
      const sourceRef = yield* Ref.make<DesktopTheme>(initialTheme);

      return ElectronTheme.of({
        shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
        getSource: Ref.get(sourceRef),
        setSource: (theme) =>
          Effect.gen(function* () {
            Electron.nativeTheme.themeSource = theme;
            yield* Ref.set(sourceRef, theme);
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
    }),
  );
