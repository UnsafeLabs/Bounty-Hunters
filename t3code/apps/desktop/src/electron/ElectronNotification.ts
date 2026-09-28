import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface ElectronNotificationOptions {
  readonly title: string;
  readonly body: string;
}

export interface ElectronNotificationShape {
  readonly show: (options: ElectronNotificationOptions) => Effect.Effect<void>;
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  ElectronNotificationShape
>()("t3/desktop/electron/Notification") {}

const make = ElectronNotification.of({
  show: (options) =>
    Effect.sync(() => {
      if (
        typeof Electron.Notification?.isSupported === "function" &&
        Electron.Notification.isSupported()
      ) {
        new Electron.Notification({
          title: options.title,
          body: options.body,
        }).show();
      }
    }),
});

export const layer = Layer.succeed(ElectronNotification, make);
