/**
 * Deep linking support via t3code:// custom protocol.
 * Opens specific projects or chats from URLs.
 */

import { app, BrowserWindow } from "electron";

interface DeepLinkRoute {
  pattern: RegExp;
  handler: (params: Record<string, string>, window: BrowserWindow) => void;
}

export class DeepLinkManager {
  private routes: DeepLinkRoute[] = [];
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.registerDefaultRoutes();
    this.setupProtocol();
  }

  private setupProtocol(): void {
    if (process.defaultApp) {
      if (process.argv.length >= 2) app.setAsDefaultProtocolClient("t3code", process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient("t3code");
    }

    app.on("open-url", (event, url) => {
      event.preventDefault();
      this.handleUrl(url);
    });
  }

  registerRoute(pattern: RegExp, handler: DeepLinkRoute["handler"]): void {
    this.routes.push({ pattern, handler });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  handleUrl(url: string): void {
    const parsed = new URL(url);
    if (parsed.protocol !== "t3code:") return;
    const path = parsed.hostname + parsed.pathname;

    for (const route of this.routes) {
      const match = path.match(route.pattern);
      if (match && this.mainWindow) {
        const params = match.groups || {};
        route.handler(params, this.mainWindow);
        this.mainWindow.show();
        this.mainWindow.focus();
        return;
      }
    }
  }

  private registerDefaultRoutes(): void {
    this.registerRoute(/^\/project\/(?<id>[^/]+)$/, (params, win) => {
      win.webContents.send("deep-link:open-project", params.id);
    });
    this.registerRoute(/^\/chat\/(?<id>[^/]+)$/, (params, win) => {
      win.webContents.send("deep-link:open-chat", params.id);
    });
    this.registerRoute(/^\/settings$/, (_params, win) => {
      win.webContents.send("deep-link:open-settings");
    });
  }
}
