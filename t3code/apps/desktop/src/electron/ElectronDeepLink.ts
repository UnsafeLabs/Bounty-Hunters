import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as ElectronApp from "./ElectronApp.ts";

export const DEEP_LINK_SCHEME = "t3code";

export const DEEP_LINK_IPC_CHANNEL = "desktop:deep-link";

export const SUPPORTED_DEEP_LINK_PATTERNS = [
  "t3code://open/project?path=<path>",
  "t3code://chat/thread?id=<id>",
  "t3code://settings",
] as const;

// ── Errors ────────────────────────────────────────────────────────────

export class DeepLinkUrlParseError extends Data.TaggedError("DeepLinkUrlParseError")<{
  readonly url: string;
  readonly message: string;
}> {
  override get message() {
    return `Failed to parse deep link URL "${this.url}": ${this.message}`;
  }
}

export class DeepLinkPathTraversalError extends Data.TaggedError("DeepLinkPathTraversalError")<{
  readonly path: string;
}> {
  override get message() {
    return `Path traversal detected in deep link path: "${this.path}"`;
  }
}

// ── Route Types ───────────────────────────────────────────────────────

export type DeepLinkRoute =
  | { readonly kind: "open-project"; readonly path: string }
  | { readonly kind: "open-thread"; readonly id: string }
  | { readonly kind: "open-settings" };

// ── Service Shape ─────────────────────────────────────────────────────

export interface ElectronDeepLinkShape {
  readonly register: Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronDeepLink extends Context.Service<
  ElectronDeepLink,
  ElectronDeepLinkShape
>()("t3/desktop/electron/DeepLink") {}

// ── URL Parsing ───────────────────────────────────────────────────────

export function parseDeepLinkUrl(
  urlString: string,
): Effect.Effect<DeepLinkRoute, DeepLinkUrlParseError> {
  return Effect.try({
    try: () => new URL(urlString),
    catch: (cause) =>
      new DeepLinkUrlParseError({
        url: urlString,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  }).pipe(Effect.flatMap((url) => {
    if (url.protocol !== `${DEEP_LINK_SCHEME}:`) {
      return Effect.fail(
        new DeepLinkUrlParseError({
          url: urlString,
          message: `Unsupported protocol: "${url.protocol}". Expected "${DEEP_LINK_SCHEME}:".`,
        }),
      );
    }

    const hostname = url.hostname;
    const pathname = url.pathname.replace(/^\/+/, "");

    if (hostname === "settings" || pathname === "settings") {
      return Effect.succeed({ kind: "open-settings" } as DeepLinkRoute);
    }

    if (hostname === "chat" || pathname.startsWith("chat/")) {
      const id = url.searchParams.get("id");
      if (!id || id.trim().length === 0) {
        return Effect.fail(
          new DeepLinkUrlParseError({
            url: urlString,
            message: 'Missing or empty "id" parameter for chat/thread route.',
          }),
        );
      }
      return Effect.succeed({ kind: "open-thread", id: id.trim() } as DeepLinkRoute);
    }

    if (hostname === "open" && pathname.startsWith("project")) {
      const rawPath = url.searchParams.get("path");
      if (!rawPath || rawPath.trim().length === 0) {
        return Effect.fail(
          new DeepLinkUrlParseError({
            url: urlString,
            message: 'Missing or empty "path" parameter for open/project route.',
          }),
        );
      }
      const validated = validateDeepLinkPath(rawPath.trim());
      if (Option.isNone(validated)) {
        return Effect.fail(new DeepLinkPathTraversalError({ path: rawPath.trim() }));
      }
      return Effect.succeed({ kind: "open-project", path: validated.value } as DeepLinkRoute);
    }

    return Effect.fail(
      new DeepLinkUrlParseError({
        url: urlString,
        message: `Unrecognized deep link route: "${hostname}/${pathname}". Supported patterns: ${SUPPORTED_DEEP_LINK_PATTERNS.join(", ")}`,
      }),
    );
  }));
}

// ── Path Validation ───────────────────────────────────────────────────

export function validateDeepLinkPath(rawPath: string): Option.Option<string> {
  // Normalize and prevent path traversal
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return Option.none();
    }
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return Option.some(normalized);
}

// ── Implementation ────────────────────────────────────────────────────

const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;

  const register = Effect.gen(function* () {
    // Register as default protocol client so OS routes t3code:// URLs to this app
    yield* Effect.sync(() => {
      Electron.app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    });

    // macOS: open-url event fires when the OS opens a t3code:// URL
    yield* electronApp.on("open-url", (_event: Electron.Event, url: string) => {
      const result = Effect.runSync(Effect.either(parseDeepLinkUrl(url)));
      if (result._tag === "Right") {
        for (const window of Electron.BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(DEEP_LINK_IPC_CHANNEL, result.right);
          }
        }
      }
    });

    // Windows/Linux: second-instance fires when a second instance passes a URL
    yield* electronApp.on(
      "second-instance",
      (_event: Electron.Event, argv: readonly string[]) => {
        // Find the first t3code:// URL in the argv
        const deepLinkArg = argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}:`));
        if (deepLinkArg) {
          const result = Effect.runSync(Effect.either(parseDeepLinkUrl(deepLinkArg)));
          if (result._tag === "Right") {
            // Focus the existing window
            const windows = Electron.BrowserWindow.getAllWindows();
            const mainWindow = windows.find((w) => !w.isDestroyed());
            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.focus();
              mainWindow.webContents.send(DEEP_LINK_IPC_CHANNEL, result.right);
            }
          }
        }
      },
    );
  }).pipe(Effect.withSpan("desktop.electron.deepLink.register"));

  return ElectronDeepLink.of({ register });
});

export const layer = Layer.effect(ElectronDeepLink, make);
