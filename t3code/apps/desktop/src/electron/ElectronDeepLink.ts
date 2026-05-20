import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export const DEEP_LINK_PROTOCOL = "t3code";

export interface ElectronDeepLinkShape {
  readonly registerProtocol: Effect.Effect<void>;
}

export class ElectronDeepLink extends Context.Service<ElectronDeepLink, ElectronDeepLinkShape>()(
  "t3/desktop/electron/DeepLink",
) {}

function parseDeepLink(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) return "";
    const path = parsed.pathname.replace(/^\/+/, "");
    switch (path) {
      case "open":
        return `/open${parsed.search}`;
      case "settings":
        return "/settings";
      case "join":
        return `/join${parsed.search}`;
      default:
        return "";
    }
  } catch {
    return "";
  }
}

const make = Effect.gen(function* () {
  const registerProtocol = Effect.gen(function* () {
    Electron.app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        Electron.app.on("open-url", (_event, url) => {
          const route = parseDeepLink(url);
          if (!route) return;
          const windows = Electron.BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (win.isDestroyed()) continue;
            win.webContents.send("deep-link", route);
          }
        });
      }),
      () =>
        Effect.sync(() => {
          Electron.app.removeAllListeners("open-url");
        }),
    );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        Electron.app.on("second-instance", (_event, argv) => {
          const url = argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`));
          if (!url) return;
          const route = parseDeepLink(url);
          if (!route) return;
          const windows = Electron.BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (win.isDestroyed()) continue;
            if (win.isMinimized()) win.restore();
            win.focus();
            win.webContents.send("deep-link", route);
          }
        });
      }),
      () =>
        Effect.sync(() => {
          Electron.app.removeAllListeners("second-instance");
        }),
    );
  }).pipe(Effect.withSpan("desktop.electron.deeplink.register"));

  return ElectronDeepLink.of({
    registerProtocol,
  });
});

export const layer = Layer.effect(ElectronDeepLink, make);
