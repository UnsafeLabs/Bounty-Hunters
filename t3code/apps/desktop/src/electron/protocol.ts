import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ElectronApp from "./ElectronApp.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronDialog from "./ElectronDialog.ts";
import type * as Electron from "electron";

const { logInfo, logError } = DesktopObservability.makeComponentLogger("desktop-protocol");

export const layer = Layer.scopedDiscard(
  Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    const dialog = yield* ElectronDialog.ElectronDialog;

    const isSuccess = yield* electronApp.setAsDefaultProtocolClient("t3code");
    if (isSuccess) {
      yield* logInfo("Registered t3code:// protocol handler");
    } else {
      yield* logError("Failed to register t3code:// protocol handler");
    }

    const handleUrl = (urlStr: string) =>
      Effect.gen(function* () {
        yield* logInfo("Received deep link URL", { url: urlStr });
        if (!urlStr.startsWith("t3code://")) return;

        try {
          // Verify URL can be parsed
          const parsed = new URL(urlStr);
          
          if (parsed.pathname.includes("..")) {
             throw new Error("Invalid path traversal in deep link");
          }
        } catch (error) {
          yield* dialog.showErrorBox(
            "Invalid Deep Link",
            `The link could not be opened: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }

        const window = yield* desktopWindow.revealOrCreateMain;
        
        const send = () => {
          if (window.isDestroyed()) return;
          window.webContents.send(IpcChannels.NAVIGATE_URL_CHANNEL, urlStr);
        };
        
        if (window.webContents.isLoadingMainFrame()) {
          window.webContents.once("did-finish-load", send);
        } else {
          send();
        }
        
        yield* desktopWindow.activate;
      }).pipe(
        Effect.catchAllCause((cause) =>
          logError("Error handling deep link URL", { cause }),
        ),
      );

    yield* electronApp.on("open-url", (event: Electron.Event, url: string) => {
      event.preventDefault();
      Effect.runFork(handleUrl(url));
    });

    yield* electronApp.on(
      "second-instance",
      (_event: Electron.Event, argv: string[]) => {
        const url = argv.find((arg) => arg.startsWith("t3code://"));
        if (url) {
          Effect.runFork(handleUrl(url));
        } else {
          Effect.runFork(
            desktopWindow.activate.pipe(Effect.catchAll(() => Effect.void)),
          );
        }
      },
    );
  }),
);
