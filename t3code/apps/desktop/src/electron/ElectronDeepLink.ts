import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as ElectronApp from "./ElectronApp.ts";
import * as ElectronProtocol from "./ElectronProtocol.ts";

export interface ElectronDeepLinkShape {
  readonly setup: Effect.Effect<void, never, Scope.Scope>;
  readonly handleCommandLineUrl: (url: string) => Effect.Effect<void, never, never>;
}

export class ElectronDeepLink extends Context.Service<ElectronDeepLink, ElectronDeepLinkShape>()(
  "t3/desktop/electron/DeepLink",
) {}

// Extract deep link URL from command line arguments
function getDeepLinkUrlFromArgs(): Option.Option<string> {
  const args = process.argv || [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && arg.startsWith("t3code://")) {
      return Option.some(arg);
    }
    // Also check for --protocol argument pattern
    if (arg === "--protocol" && i + 1 < args.length && args[i + 1] === "t3code") {
      // The URL should be the next argument after the protocol
      for (let j = i + 2; j < args.length; j++) {
        if (args[j] && args[j].startsWith("t3code://")) {
          return Option.some(args[j]);
        }
      }
    }
  }
  
  return Option.none();
}

// Handle deep link action by sending to renderer
function handleDeepLinkAction(action: ElectronProtocol.DeepLinkAction): void {
  console.log("Handling deep link action:", action);
  
  // Send action to all windows via IPC
  const windows = Electron.BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    for (const window of windows) {
      window.webContents.send("deep-link-action", action);
    }
  }
}

// Show error notification for invalid deep links
function showDeepLinkError(url: string, error: unknown): void {
  console.error("Failed to parse deep link:", error);
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (Electron.Notification.isSupported()) {
    new Electron.Notification({
      title: "Invalid Deep Link",
      body: `Failed to parse URL: ${url}\nError: ${errorMessage}`,
    }).show();
  }
}

const make = ElectronDeepLink.of({
  setup: Effect.gen(function* () {
    const app = yield* ElectronApp.ElectronApp;
    const protocol = yield* ElectronProtocol.ElectronProtocol;

    // Register deep link protocol
    yield* protocol.registerDeepLinkProtocol;

    // Handle open-url event for deep linking
    yield* app.on("open-url", (event, url) => {
      event.preventDefault();
      
      // Only handle t3code:// URLs
      if (!url.startsWith("t3code://")) {
        return;
      }

      // Parse and handle the deep link URL
      Effect.runPromise(protocol.parseDeepLinkUrl(url)).then(
        (action) => handleDeepLinkAction(action),
        (error) => showDeepLinkError(url, error),
      );
    });

    // Handle command line URL when app is launched with deep link
    const maybeUrl = getDeepLinkUrlFromArgs();
    if (Option.isSome(maybeUrl)) {
      yield* app.whenReady;
      
      // Wait a bit for the app to be ready, then handle the URL
      setTimeout(() => {
        Effect.runPromise(protocol.parseDeepLinkUrl(maybeUrl.value)).then(
          (action) => handleDeepLinkAction(action),
          (error) => showDeepLinkError(maybeUrl.value, error),
        );
      }, 1000);
    }

    // Handle second instance with deep link URL
    yield* app.on("second-instance", (_event, argv) => {
      const urlFromArgs = getDeepLinkUrlFromArgs();
      if (Option.isSome(urlFromArgs)) {
        Effect.runPromise(protocol.parseDeepLinkUrl(urlFromArgs.value)).then(
          (action) => {
            // Focus existing window and send action
            const windows = Electron.BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              windows[0].focus();
              windows[0].webContents.send("deep-link-action", action);
            }
          },
          (error) => showDeepLinkError(urlFromArgs.value, error),
        );
      }
    });
  }).pipe(Effect.withSpan("desktop.electron.deepLink.setup")),
  
  handleCommandLineUrl: (url: string) => {
    return Effect.gen(function* () {
      const protocol = yield* ElectronProtocol.ElectronProtocol;
      
      if (!url.startsWith("t3code://")) {
        return;
      }

      const action = yield* protocol.parseDeepLinkUrl(url);
      handleDeepLinkAction(action);
    });
  },
});

export const layer = Layer.effect(ElectronDeepLink, make);
