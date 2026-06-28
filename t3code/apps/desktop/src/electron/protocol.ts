import { app, dialog, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";

let pendingDeepLink: { type: string; params: any } | null = null;

export function getPendingDeepLink() {
  const temp = pendingDeepLink;
  pendingDeepLink = null;
  return temp;
}

export function handleDeepLinkUrl(urlStr: string) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "t3code:") {
      return;
    }

    const host = parsed.host;
    const pathname = parsed.pathname;
    let type = "";
    const params: Record<string, string> = {};

    if (host === "open" && pathname === "/project") {
      type = "open-project";
      const projectPath = parsed.searchParams.get("path");
      if (!projectPath) {
        throw new Error("Missing 'path' parameter");
      }
      if (
        projectPath.includes("..") ||
        projectPath.includes("../") ||
        projectPath.includes("..\\")
      ) {
        dialog.showErrorBox(
          "Security Warning",
          "Path traversal attempts in project path are rejected."
        );
        return;
      }
      params.path = projectPath;
    } else if (host === "chat" && pathname === "/thread") {
      type = "chat-thread";
      const threadId = parsed.searchParams.get("id");
      if (!threadId) {
        throw new Error("Missing 'id' parameter");
      }
      params.id = threadId;
    } else if (host === "settings") {
      type = "settings";
    } else {
      throw new Error(`Invalid path: ${host}${pathname}`);
    }

    const payload = { type, params };
    const windows = BrowserWindow.getAllWindows();
    const mainWin = windows[0];

    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("desktop:deep-link", payload);
    } else {
      pendingDeepLink = payload;
    }
  } catch (error: any) {
    dialog.showErrorBox(
      "Invalid Deep Link",
      `The URL could not be parsed: ${error.message}`
    );
  }
}

export function registerDeepLinkProtocol() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("t3code", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("t3code");
  }
}

export function initializeSingleInstanceAndDeepLinks() {
  // Register protocol
  registerDeepLinkProtocol();

  // Enforce single instance lock
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    process.exit(0);
  }

  // Handle second-instance URL arguments
  app.on("second-instance", (event, argv) => {
    const url = argv.find(arg => arg.startsWith("t3code://"));
    if (url) {
      handleDeepLinkUrl(url);
    }
  });

  // Handle open-url on macOS
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
  });

  // Handle initial launch arguments
  const initialUrl = process.argv.find(arg => arg.startsWith("t3code://"));
  if (initialUrl) {
    handleDeepLinkUrl(initialUrl);
  }

  // Register IPC handler to fetch pending deep links
  ipcMain.handle("desktop:get-pending-deep-link", () => {
    return getPendingDeepLink();
  });
}
