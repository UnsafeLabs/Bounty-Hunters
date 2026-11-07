import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

export const DEEP_LINK_SCHEME = "t3code";

// Deep link URL patterns
export const DeepLinkPattern = {
  OPEN_PROJECT: /^t3code:\/\/open\/project\?path=(.+)$/i,
  CHAT_THREAD: /^t3code:\/\/chat\/thread\?id=(.+)$/i,
  SETTINGS: /^t3code:\/\/settings$/i,
} as const;

// Deep link types
export type DeepLinkType = "open-project" | "chat-thread" | "settings" | "unknown";

export interface DeepLink {
  readonly type: DeepLinkType;
  readonly url: string;
  readonly params: Record<string, string>;
}

// Path traversal validation
export class PathTraversalError extends Schema.TaggedError<PathTraversalError>()(
  "PathTraversalError",
  {
    message: Schema.String,
    path: Schema.String,
  },
) {}

export function validateProjectPath(rawPath: string): Effect.Effect<string, PathTraversalError> {
  return Effect.gen(function* () {
    const decoded = decodeURIComponent(rawPath);
    const normalized = decoded.replace(/\\/g, "/");

    // Check for path traversal attempts
    const segments = normalized.split("/");
    for (const segment of segments) {
      if (segment === ".." || segment.includes("..")) {
        return yield* new PathTraversalError({
          message: "Path traversal attempt detected",
          path: decoded,
        });
      }
    }

    // Check for absolute path on Windows (e.g., C:/)
    if (/^[a-zA-Z]:/.test(normalized)) {
      return decoded; // Allow absolute paths on Windows
    }

    // Check for Unix absolute paths
    if (normalized.startsWith("/")) {
      return decoded;
    }

    return decoded;
  });
}

// Parse deep link URL
export function parseDeepLink(url: string): DeepLink {
  // Check for project open link
  const projectMatch = url.match(DeepLinkPattern.OPEN_PROJECT);
  if (projectMatch) {
    return {
      type: "open-project",
      url,
      params: { path: projectMatch[1] },
    };
  }

  // Check for chat thread link
  const threadMatch = url.match(DeepLinkPattern.CHAT_THREAD);
  if (threadMatch) {
    return {
      type: "chat-thread",
      url,
      params: { id: threadMatch[1] },
    };
  }

  // Check for settings link
  if (DeepLinkPattern.SETTINGS.test(url)) {
    return {
      type: "settings",
      url,
      params: {},
    };
  }

  return {
    type: "unknown",
    url,
    params: {},
  };
}

// Deep link service interface
export interface DeepLinkServiceShape {
  readonly handleDeepLink: (url: string) => Effect.Effect<void, PathTraversalError>;
  readonly registerProtocol: () => Effect.Effect<void>;
}

export class DeepLinkService extends Context.Service<DeepLinkService, DeepLinkServiceShape>()(
  "t3/desktop/DeepLinkService",
) {}

// IPC channels for deep link communication
export const DEEP_LINK_IPC_CHANNEL = "deep-link:navigate";

const make = Effect.gen(function* () {
  const handleDeepLink = Effect.fn("desktop.deepLink.handleDeepLink")(
    function* (url: string): Effect.fn.Return<void, PathTraversalError> {
      const deepLink = parseDeepLink(url);

      // Validate project path if it's a project open link
      if (deepLink.type === "open-project" && deepLink.params.path) {
        yield* validateProjectPath(deepLink.params.path);
      }

      // Send to renderer via IPC
      const mainWindow = Electron.BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send(DEEP_LINK_IPC_CHANNEL, deepLink);

        // Focus the window if it's not already focused
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        if (!mainWindow.isFocused()) {
          mainWindow.focus();
        }
      }

      return;
    },
  );

  const registerProtocol = Effect.fn("desktop.deepLink.registerProtocol")(function* () {
    // Register the protocol as the default handler
    const app = Electron.app;

    // Register on macOS and Windows
    if (process.platform === "darwin" || process.platform === "win32") {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    }

    // Handle deep links on macOS (open-url event)
    app.on("open-url", (event, url) => {
      event.preventDefault();
      void Effect.runPromise(handleDeepLink(url));
    });

    // Handle deep links on Windows (second-instance event)
    app.on("second-instance", (_event, commandLine) => {
      // On Windows, the deep link URL is in the command line arguments
      const deepLinkUrl = commandLine.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
      if (deepLinkUrl) {
        void Effect.runPromise(handleDeepLink(deepLinkUrl));
      }
    });

    // Handle deep link on app launch (all platforms)
    const startupUrl = app.commandLine.getSwitchValue("startup-url");
    if (startupUrl && startupUrl.startsWith(`${DEEP_LINK_SCHEME}://`)) {
      // Wait for app to be ready
      yield* Effect.promise(() => app.whenReady());
      void Effect.runPromise(handleDeepLink(startupUrl));
    }

    return;
  });

  return DeepLinkService.of({
    handleDeepLink,
    registerProtocol,
  });
});

export const DeepLinkServiceLive = Layer.effect(DeepLinkService, make);

// React hook for handling deep links in the renderer process
export function useDeepLinkHandler(
  onDeepLink: (deepLink: DeepLink) => void,
): Option.Option<DeepLink> {
  const [pendingDeepLink, setPendingDeepLink] = Option.option<DeepLink>(Option.none());

  Effect.runSync(
    Effect.gen(function* () {
      const { ipcRenderer } = yield* Effect.promise(() => import("electron"));

      const handler = (_event: any, deepLink: DeepLink) => {
        setPendingDeepLink(Option.some(deepLink));
        onDeepLink(deepLink);
      };

      ipcRenderer.on(DEEP_LINK_IPC_CHANNEL, handler);

      return () => {
        ipcRenderer.removeListener(DEEP_LINK_IPC_CHANNEL, handler);
      };
    }),
  );

  return pendingDeepLink;
}
