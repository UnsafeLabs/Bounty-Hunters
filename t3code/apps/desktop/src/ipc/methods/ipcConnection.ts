import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const IpcConnectionStateSchema = Schema.Literals([
  "connected",
  "disconnected",
  "reconnecting",
]);

export const getIpcConnectionState = makeIpcMethod({
  channel: IpcChannels.GET_IPC_CONNECTION_STATE_CHANNEL,
  payload: Schema.Void,
  result: IpcConnectionStateSchema,
  handler: Effect.fn("desktop.ipc.connection.getState")(function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    return yield* ipc.connectionState;
  }),
});
