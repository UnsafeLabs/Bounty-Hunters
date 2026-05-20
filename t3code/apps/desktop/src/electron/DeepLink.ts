/**
 * Deep linking support via t3code:// custom protocol.
 *
 * Handles URL patterns:
 * - t3code://open/project?path=/path/to/repo
 * - t3code://chat/thread?id=abc123
 * - t3code://settings
 */

import { app, ipcMain, protocol, BrowserWindow } from "electron";
import * as path from "node:path";

const DEEP_LINK_SCHEME = "t3code";

export interface DeepLinkPayload {
  readonly action: "open-project" | "open-thread" | "open-settings";
  readonly params: Record<string, string>;
}

/**
 * Parse a t3code:// URL into an action and parameters.
 */
export function parseDeepLinkUrl(url: string): DeepLinkPayload | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return null;

    const pathParts = parsed.pathname.replace(/^\//, "").split("/");

    if (pathParts[0] === "open" && pathParts[1] === "project") {
      return {
        action: "open-project",
        params: Object.fromEntries(parsed.searchParams),
      };
    }

    if (pathParts[0] === "chat" && pathParts[1] === "thread") {
      return {
        action: "open-thread",
        params: Object.fromEntries(parsed.searchParams),
      };
    }

    if (pathParts[0] === "settings") {
      return {
        action: "open-settings",
        params: Object.fromEntries(parsed.searchParams),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Register the t3code:// protocol handler and set up IPC listeners
 * for forwarding deep link payloads to the renderer.
 */
export function registerDeepLinkProtocol(): void {
  // Register as default protocol for the scheme
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  // Handle deep links on macOS (open-url event)
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Handle deep links on Windows/Linux (second-instance with args)
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on("second-instance", (_event, argv) => {
      const url = argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
      if (url) {
        handleDeepLink(url);
      }
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }

  // Handle deep link from command line on startup
  const deepLinkUrl = process.argv.find((arg) =>
    arg.startsWith(`${DEEP_LINK_SCHEME}://`),
  );
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl);
  }
}

function handleDeepLink(url: string): void {
  const payload = parseDeepLinkUrl(url);
  if (!payload) return;

  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send("deep-link", payload);
  }
}
