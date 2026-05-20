import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as ElectronWindow from "./ElectronWindow.ts";

export interface ElectronTrayShape {
  readonly updateConnectionStatus: (connected: boolean) => Effect.Effect<void>;
  readonly create: Effect.Effect<void>;
}

export class ElectronTray extends Context.Service<ElectronTray, ElectronTrayShape>()(
  "t3/desktop/electron/Tray",
) {}

const { logWarning: logTrayWarning } = DesktopObservability.makeComponentLogger("desktop-tray");

type ElectronTrayRuntimeServices =
  | DesktopWindow.DesktopWindow
  | DesktopAssets.DesktopAssets
  | ElectronWindow.ElectronWindow;

const make = Effect.gen(function* () {
  const trayRef = yield* Ref.make<Option.Option<Electron.Tray>>(Option.none());
  const connectedRef = yield* Ref.make(false);

  const updateConnectionStatus = Effect.fn("desktop.electron.tray.updateConnectionStatus")(
    function* (connected: boolean) {
      yield* Ref.set(connectedRef, connected);
      const tray = yield* Ref.get(trayRef);
      if (Option.isNone(tray)) return;
      const context = yield* Effect.context<ElectronTrayRuntimeServices>();
      const runPromise = Effect.runPromiseWith(context);
      const desktopWindow = yield* DesktopWindow.DesktopWindow;

      const contextMenu = Electron.Menu.buildFromTemplate([
        {
          label: connected ? "Connected" : "Disconnected",
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Show T3 Code",
          click: () => {
            void runPromise(
              desktopWindow.revealOrCreateMain.pipe(
                Effect.catchCause((cause) =>
                  logTrayWarning("failed to reveal window from tray", {
                    cause: cause.toString(),
                  }),
                ),
              ),
            );
          },
        },
        {
          label: "Hide",
          click: () => {
            const windows = Electron.BrowserWindow.getAllWindows();
            for (const win of windows) {
              if (win.isDestroyed()) continue;
              win.hide();
            }
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            Electron.app.quit();
          },
        },
      ]);
      tray.value.setContextMenu(contextMenu);
    },
  );

  const create = Effect.gen(function* () {
    const existingTray = yield* Ref.get(trayRef);
    if (Option.isSome(existingTray)) return;

    const assets = yield* DesktopAssets.DesktopAssets;
    const iconPaths = yield* assets.iconPaths;
    const iconPath = Option.match(iconPaths["png"] ?? iconPaths["ico"], {
      onNone: () => Option.fromNullishOr(iconPaths["ico"]),
      onSome: (p) => Option.some(p),
    });

    if (Option.isNone(iconPath)) {
      yield* logTrayWarning("no tray icon path available");
      return;
    }

    const tray = new Electron.Tray(iconPath.value);
    tray.setToolTip("T3 Code");
    yield* Ref.set(trayRef, Option.some(tray));

    yield* updateConnectionStatus(false);
  }).pipe(Effect.withSpan("desktop.electron.tray.create"));

  return ElectronTray.of({
    updateConnectionStatus,
    create,
  });
});

export const layer = Layer.effect(ElectronTray, make);
