import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface ElectronNotificationShape {
  readonly show: (input: { readonly title: string; readonly body: string }) => Effect.Effect<void>;
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  ElectronNotificationShape
>()("t3/desktop/electron/Notification") {}

const make = ElectronNotification.of({
  show: ({ title, body }) =>
    Effect.sync(() => {
      new Electron.Notification({ title, body }).show();
    }),
});

export const layer = Layer.succeed(ElectronNotification, make);
