import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Duration from "effect/Duration";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";

export class IpcMessage extends Data.Class<{
  id: string;
  channel: string;
  payload: unknown;
  timestamp: number;
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly message: string;
}>() {}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()("t3/desktop/Ipc") {}

export type ConnectionState = "connected" | "disconnected" | "reconnecting";
export const ConnectionStatus = Context.GenericTag<ConnectionState>("@@t3/desktop/ipc/connection-state");

export interface QueuedIpcMessage {
  readonly id: string;
  readonly channel: string;
 readonly payload: unknown;
  readonly timestamp: number;
}

export const make = (ipcMain: DesktopIpcMain): DesktopIpcShape => {
  const baseIpc = DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
      channel,
      handler,
    }: DesktopIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, (_event, raw) =>
            runPromise(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({ channel });
                return yield* handler(raw);
              }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
            ),
          );
        }),
        () => Effect.sync(() => ipcMain.removeHandler(channel)),
      );
    }),

    handleSync: Effect.fn("desktop.ipc.registerSync")(function* <E, R>({
      channel,
      handler,
    }: DesktopSyncIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runSync = Effect.runSyncWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeAllListeners(channel);
          ipcMain.on(channel, (event) => {
            event.returnValue = runSync(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({ channel });
                return yield* handler();
              }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invokeSync")),
            );
          });
        }),
        () => Effect.sync(() => ipcMain.removeAllListeners(channel)),
      );
    }),
  });

  // Add queuing functionality
  const makeWithQueue = (ipcMain: DesktopIpcMain): DesktopIpcShape => {
    interface DesktopIpcShapeWithQueue extends DesktopIpcShape {
      readonly messageQueue: Queue.Queue<QueuedIpcMessage>;
      readonly connectionState: Stream.Stream<ConnectionState, never, never>;
    }
    
    // Create the base IPC service
    const baseIpcShape = baseIpc;
    
    // Add queue management
    const messageQueue = yield* Queue.bounded<QueuedIpcMessage>(100);
    const connectionState = Stream.fromSchedule(Schedule.spaced("5 seconds")).pipe(
      Stream.map(() => "connected" as const)
    );
    
    return DesktopIpc.of({
      ...baseIpcShape,
      messageQueue,
      connectionState
    } as any) as any;
  };
  
  return makeWithQueue(ipcMain);
};

export const {
  handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
    channel,
    handler,
  }: DesktopIpcMethod<E, R>) {
    yield* Effect.annotateCurrentSpan({ channel });
    const context = yield* Effect.context<R>();
    const runPromise = Effect.runPromiseWith(context);

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, raw) =>
          runPromise(
            Effect.gen(function* () {
              yield* Effect.annotateCurrentSpan({ channel });
              return yield* handler(raw);
            }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
          ),
        );
      }),
      () => Effect.sync(() => ipcMain.removeHandler(channel)),
    );
  }),

  handleSync: Effect.fn("desktop.ipc.registerSync")(function* <E, R>({
    channel,
    handler,
  }: DesktopSyncIpcMethod<E, R>) {
    yield* Effect.annotateCurrentSpan({ channel });
    const context = yield* Effect.context<R>();
    const runSync = Effect.runSyncWith(context);

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        ipcMain.removeAllListeners(channel);
        ipcMain.on(channel, (event) => {
          event.returnValue = runSync(
            Effect.gen(function* () {
              yield* Effect.annotateCurrentSpan({ channel });
              return yield* handler();
            }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invokeSync")),
          );
        });
      }),
      () => Effect.sync(() => ipcMain.removeAllListeners(channel)),
    );
  }),
});

export interface DesktopIpcSyncEvent {
  returnValue: unknown;
}

export type DesktopIpcHandleListener = (
  event: DesktopIpcInvokeEvent,
  raw: unknown,
) => unknown | Promise<unknown>;

export type DesktopIpcSyncListener = (event: DesktopIpcSyncEvent) => void;

export interface DesktopIpcMain {
  removeHandler(channel: string): void;
  handle(channel: string, listener: DesktopIpcHandleListener): void;
  removeAllListeners(channel: string): void;
  on(channel: string, listener: DesktopIpcSyncListener): void;
}

export interface DesktopIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: (raw: unknown) => Effect.Effect<unknown, E, R>;
}

export interface DesktopSyncIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: () => Effect.Effect<unknown, E, R>;
}

export interface DesktopIpcShape {
  readonly handle: <E, R>(
    input: DesktopIpcMethod<E, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
  readonly handleSync: <E, R>(
    input: DesktopSyncIpcMethod<E, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()("t3/desktop/Ipc") {}

export const make = (ipcMain: DesktopIpcMain): DesktopIpcShape =>
  DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
      channel,
      handler,
    }: DesktopIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, (_event, raw) =>
            runPromise(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({ channel });
                return yield* handler(raw);
              }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
            ),
          );
        }),
        () => Effect.sync(() => ipcMain.removeHandler(channel)),
      );
    }),

    handleSync: Effect.fn("desktop.ipc.registerSync")(function* <E, R>({
      channel,
      handler,
    }: DesktopSyncIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runSync = Effect.runSyncWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeAllListeners(channel);
          ipcMain.on(channel, (event) => {
            event.returnValue = runSync(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({ channel });
                return yield* handler();
              }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invokeSync")),
            );
          });
        }),
        () => Effect.sync(() => ipcMain.removeAllListeners(channel)),
      );
    }),
  });

/**
 * Convenience helpers for creating IPC methods
 */

export interface DesktopIpcMethodRegistration<
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly payload: Schema.Codec<
    Payload,
    EncodedPayload,
    PayloadDecodingServices,
    PayloadEncodingServices
  >;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: (input: Payload) => Effect.Effect<Result, E, R>;
}

export const makeIpcMethod = <
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopIpcMethodRegistration<
    Payload,
    EncodedPayload,
    Result,
    EncodedResult,
    E,
    R,
    PayloadDecodingServices,
    PayloadEncodingServices,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopIpcMethod<
  E | Schema.SchemaError,
  R | PayloadDecodingServices | ResultEncodingServices
> => {
  const decode = Schema.decodeUnknownEffect(method.payload);
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: (raw) =>
      decode(raw).pipe(
        Effect.flatMap(method.handler),
        Effect.flatMap(encode),
        Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
      ),
  };
};

export interface DesktopSyncIpcMethodRegistration<
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: () => Effect.Effect<Result, E, R>;
}

export const makeSyncIpcMethod = <
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopSyncIpcMethodRegistration<
    Result,
    EncodedResult,
    E,
    R,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopSyncIpcMethod<E | Schema.SchemaError, R | ResultEncodingServices> => {
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: () =>
      method
        .handler()
        .pipe(
          Effect.flatMap(encode),
          Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
        ),
  };
};
