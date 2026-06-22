import { DesktopBackendConnectionStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

/**
 * Lets the renderer read the current backend connection state on demand (for the
 * initial value), complementing the {@link broadcastBackendConnectionState} push.
 *
 * Registered as a synchronous IPC method so it bypasses the message queue: a
 * disconnect is exactly when the renderer needs to read this, so it must never be
 * buffered behind the very disconnect it reports.
 */
export const getBackendConnectionState = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_BACKEND_CONNECTION_STATE_CHANNEL,
  result: DesktopBackendConnectionStateSchema,
  handler: Effect.fn("desktop.ipc.backendConnection.getState")(function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    return yield* ipc.messageQueue.connectionState;
  }),
});

/**
 * Forwards every backend connection-state transition from the IPC message queue
 * to all renderer windows, so the web UI can subscribe to the live state through
 * {@link IpcChannels.BACKEND_CONNECTION_STATE_CHANNEL}. The subscription is torn
 * down when the surrounding scope closes.
 */
export const broadcastBackendConnectionState = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);

  const unsubscribe = yield* ipc.messageQueue.subscribe((state) => {
    void runPromise(electronWindow.sendAll(IpcChannels.BACKEND_CONNECTION_STATE_CHANNEL, state));
  });
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
}).pipe(Effect.withSpan("desktop.ipc.backendConnection.broadcast"));
