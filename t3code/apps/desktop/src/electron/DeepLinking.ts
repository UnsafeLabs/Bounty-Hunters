/**
 * Deep linking support for T3 Code desktop app.
 *
 * Handles t3code:// protocol URLs for opening specific projects,
 * chat threads, and settings from external sources.
 *
 * @module DeepLinking
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";

import * as Electron from "electron";

/**
 * Supported deep link URL patterns:
 * - t3code://open/project?path=/path/to/repo
 * - t3code://chat/thread?id=abc123
 * - t3code://settings
 */

export interface DeepLinkCommand {
  readonly type: "open-project" | "open-thread" | "open-settings";
  readonly params: Record<string, string>;
}

export interface DeepLinkingShape {
  readonly registerProtocol: Effect.Effect<void>;
  readonly getLastCommand: Effect.Effect<Option.Option<DeepLinkCommand>>;
  readonly onCommand: (listener: (command: DeepLinkCommand) => void) => Effect.Effect<void>;
}

export class DeepLinking extends Context.Service<DeepLinking, DeepLinkingShape>()(
  "t3/desktop/DeepLinking",
) {}

/**
 * Parse a t3code:// URL into a DeepLinkCommand.
 */
function parseDeepLink(url: string): Option.Option<DeepLinkCommand> {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "t3code:") {
      return Option.none();
    }

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // Route based on hostname and pathname
    const path = parsed.hostname + parsed.pathname;

    if (path === "open/project" && params.path) {
      // Validate path to prevent traversal attacks
      if (params.path.includes("..") || !params.path.startsWith("/")) {
        return Option.none();
      }
      return Option.some({ type: "open-project", params });
    }

    if (path === "chat/thread" && params.id) {
      return Option.some({ type: "open-thread", params });
    }

    if (path === "settings" || parsed.hostname === "settings") {
      return Option.some({ type: "open-settings", params });
    }

    return Option.none();
  } catch {
    return Option.none();
  }
}

const make = Effect.gen(function* () {
  const lastCommand = yield* Ref.make<Option.Option<DeepLinkCommand>>(Option.none());
  const listeners = yield* Ref.make<Array<(command: DeepLinkCommand) => void>>([]);

  const notifyListeners = (command: DeepLinkCommand) =>
    Effect.sync(() => {
      const currentListeners = Ref.get(listeners);
      for (const listener of currentListeners) {
        try {
          listener(command);
        } catch {
          // Ignore listener errors
        }
      }
    });

  const registerProtocol = Effect.sync(() => {
    // Set as default protocol client
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        Electron.app.setAsDefaultProtocolClient("t3code", process.execPath, [
          process.argv[1],
        ]);
      }
    } else {
      Electron.app.setAsDefaultProtocolClient("t3code");
    }

    // Handle protocol on macOS (open-url event)
    Electron.app.on("open-url", (event, url) => {
      event.preventDefault();
      const command = parseDeepLink(url);
      if (Option.isSome(command)) {
        Ref.set(lastCommand, command);
        Effect.runSync(notifyListeners(command.value));
      }
    });

    // Handle protocol on Windows/Linux (second instance)
    const gotSingleInstanceLock = Electron.app.requestSingleInstanceLock();
    if (!gotSingleInstanceLock) {
      Electron.app.quit();
    } else {
      Electron.app.on("second-instance", (event, commandLine) => {
        // Focus the existing window
        const windows = Electron.BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          const mainWindow = windows[0];
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }

        // Parse deep link from command line (Windows/Linux)
        const url = commandLine.find((arg) => arg.startsWith("t3code://"));
        if (url) {
          const parsed = parseDeepLink(url);
          if (Option.isSome(parsed)) {
            Ref.set(lastCommand, parsed);
            Effect.runSync(notifyListeners(parsed.value));
          }
        }
      });
    }
  });

  const getLastCommand = Ref.get(lastCommand);

  const onCommand = (listener: (command: DeepLinkCommand) => void) =>
    Effect.acquireRelease(
      Ref.update(listeners, (l) => [...l, listener]),
      () => Ref.update(listeners, (l) => l.filter((l) => l !== listener)),
    );

  return DeepLinking.of({
    registerProtocol,
    getLastCommand,
    onCommand,
  });
});

export const layer = Layer.effect(DeepLinking, make);
