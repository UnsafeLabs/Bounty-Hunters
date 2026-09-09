/**
 * ElectronDeepLink - Deep linking support via t3code:// custom protocol.
 *
 * Registers `t3code://` protocol to open projects, chat threads, and settings
 * from external sources (browser links).
 *
 * Supported URL patterns:
 *   t3code://open/project?path=/path/to/repo
 *   t3code://chat/thread?id=abc123
 *   t3code://settings
 *
 * @module ElectronDeepLink
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import { ElectronApp, type ElectronAppShape } from "./ElectronApp.ts";

export const DEEP_LINK_SCHEME = "t3code";

export class DeepLinkInvalidURLError extends Data.TaggedError("DeepLinkInvalidURLError")<{
  readonly url: string;
  readonly reason: string;
}> {
  override get message() {
    return `Invalid deep link URL: ${this.reason}`;
  }
}

export class DeepLinkPathTraversalError extends Data.TaggedError(
  "DeepLinkPathTraversalError",
)<{
  readonly path: string;
}> {
  override get message() {
    return `Path traversal attempt detected: ${this.path}`;
  }
}

export class DeepLinkNavigationError extends Data.TaggedError("DeepLinkNavigationError")<{
  readonly reason: string;
}> {
  override get message() {
    return `Deep link navigation failed: ${this.reason}`;
  }
}

// --- URL Patterns ---
export type DeepLinkAction =
  | { type: "open-project"; path: string }
  | { type: "chat-thread"; id: string }
  | { type: "settings" };

export interface DeepLinkShape {
  readonly registerDeepLinkProtocol: Effect.Effect<void, never, Scope.Scope>;
  readonly handleDeepLinkURL: (url: string) => Effect.Effect<DeepLinkAction, DeepLinkInvalidURLError | DeepLinkPathTraversalError>;
  readonly navigateToAction: (action: DeepLinkAction) => Effect.Effect<void, DeepLinkNavigationError>;
}

export class ElectronDeepLink extends Context.Service<ElectronDeepLink, DeepLinkShape>()(
  "t3/desktop/electron/DeepLink",
) {}

// --- Path traversal prevention ---
function isPathTraversal(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.includes("..") || normalized.startsWith("/");
}

// --- URL parsing ---
function parseDeepLinkURL(url: string): Option.Option<DeepLinkAction> {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
      return Option.none();
    }

    const hostname = parsed.hostname;
    const pathname = parsed.pathname.replace(/^\/+/, "");

    switch (hostname) {
      case "open": {
        if (pathname === "project" || pathname === "project/") {
          const path = parsed.searchParams.get("path");
          if (!path) {
            return Option.none();
          }
          return Option.some({ type: "open-project", path });
        }
        return Option.none();
      }

      case "chat": {
        if (pathname === "thread" || pathname === "thread/") {
          const id = parsed.searchParams.get("id");
          if (!id) {
            return Option.none();
          }
          return Option.some({ type: "chat-thread", id });
        }
        return Option.none();
      }

      case "settings": {
        return Option.some({ type: "settings" });
      }

      default:
        return Option.none();
    }
  } catch {
    return Option.none();
  }
}

// --- Layer ---
export const ElectronDeepLinkLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const electronApp = yield* ElectronApp;

    // Register as default protocol client on startup
    const success = Electron.app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    if (!success) {
      console.warn("[DeepLink] Failed to register as default protocol client");
    }

    // Handle deep links when app is already running
    Electron.app.on("open-url", (event, url) => {
      event.preventDefault();
      void Effect.runPromise(handleDeepLinkURL(url));
    });

    // Handle deep links on Windows/Linux (macOS uses open-url event)
    Electron.app.on("second-instance", (_event, commandLine) => {
      const url = commandLine.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
      if (url) {
        void Effect.runPromise(handleDeepLinkURL(url));
      }
    });

    // Handle deep links when app was launched via protocol (macOS)
    const gotTheLock = Electron.app.requestSingleInstanceLock();
    if (!gotTheLock) {
      Electron.app.quit();
      return;
    }

    console.log("[DeepLink] Registered t3code:// protocol handler");
  }),
);

async function handleDeepLinkURL(url: string): Promise<void> {
  const action = parseDeepLinkURL(url);
  if (Option.isNone(action)) {
    console.warn(`[DeepLink] Invalid URL: ${url}`);
    return;
  }

  console.log(`[DeepLink] Handling: ${JSON.stringify(action.value)}`);

  // TODO: Route to web app via IPC
  // This would send the action to the renderer process
  // via ipcRenderer/invoke to navigate the web app.
  switch (action.value.type) {
    case "open-project":
      console.log(`[DeepLink] Would open project: ${action.value.path}`);
      break;
    case "chat-thread":
      console.log(`[DeepLink] Would open chat thread: ${action.value.id}`);
      break;
    case "settings":
      console.log("[DeepLink] Would open settings");
      break;
  }
}
