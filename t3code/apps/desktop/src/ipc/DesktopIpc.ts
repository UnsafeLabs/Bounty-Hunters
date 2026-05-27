import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MESSAGE_TIMEOUT_MS = 30_000;

export interface DesktopIpcInvokeEvent {}

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
  readonly queueWhenDisconnected?: boolean;
}

export interface DesktopSyncIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: () => Effect.Effect<unknown, E, R>;
}

export type DesktopIpcConnectionState = "connected" | "disconnected" | "reconnecting";

export class DesktopIpcQueueTimeoutError extends Data.TaggedError("DesktopIpcQueueTimeoutError")<{
  readonly channel: string;
  readonly ageMs: number;
  readonly reason: "expired" | "queue-full";
}> {
  override get message() {
    return `Desktop IPC request on ${this.channel} ${this.reason === "expired" ? "expired" : "was dropped"} after ${this.ageMs}ms in the reconnect queue.`;
  }
}

export interface DesktopIpcOptions {
  readonly initialConnectionState?: DesktopIpcConnectionState;
  readonly maxQueueSize?: number;
  readonly messageTimeoutMs?: number;
  readonly now?: () => number;
}

export interface DesktopIpcShape {
  readonly handle: <E, R>(
    input: DesktopIpcMethod<E, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
  readonly handleSync: <E, R>(
    input: DesktopSyncIpcMethod<E, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
  readonly connectionState: Effect.Effect<DesktopIpcConnectionState>;
  readonly setConnectionState: (state: DesktopIpcConnectionState) => Effect.Effect<void>;
  readonly subscribeConnectionState: (
    listener: (state: DesktopIpcConnectionState) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()("t3/desktop/Ipc") {}

interface QueuedInvocation {
  readonly channel: string;
  readonly createdAt: number;
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: unknown) => void;
  timeoutFiber: Fiber.Fiber<void, never> | undefined;
}

export const make = (ipcMain: DesktopIpcMain, options: DesktopIpcOptions = {}): DesktopIpcShape => {
  const maxQueueSize = Math.max(1, options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);
  const messageTimeoutMs = Math.max(1, options.messageTimeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS);
  const now = options.now ?? (() => DateTime.toEpochMillis(DateTime.nowUnsafe()));
  const queue: QueuedInvocation[] = [];
  const subscribers = new Set<(state: DesktopIpcConnectionState) => Effect.Effect<void>>();
  let connectionState = options.initialConnectionState ?? "connected";
  let flushing = false;

  const failQueued = (item: QueuedInvocation, reason: DesktopIpcQueueTimeoutError["reason"]) => {
    if (item.timeoutFiber !== undefined) {
      Effect.runFork(Fiber.interrupt(item.timeoutFiber));
      item.timeoutFiber = undefined;
    }
    item.reject(
      new DesktopIpcQueueTimeoutError({
        channel: item.channel,
        ageMs: Math.max(0, now() - item.createdAt),
        reason,
      }),
    );
  };

  const removeQueued = (item: QueuedInvocation): boolean => {
    const index = queue.indexOf(item);
    if (index === -1) return false;
    queue.splice(index, 1);
    return true;
  };

  const flushQueue = () => {
    if (flushing || connectionState !== "connected") {
      return;
    }

    flushing = true;
    void (async () => {
      try {
        for (;;) {
          if (connectionState !== "connected" || queue.length === 0) {
            break;
          }
          const item = queue.shift();
          if (item === undefined) continue;
          if (item.timeoutFiber !== undefined) {
            Effect.runFork(Fiber.interrupt(item.timeoutFiber));
            item.timeoutFiber = undefined;
          }
          try {
            item.resolve(await item.run());
          } catch (cause) {
            item.reject(cause);
          }
        }
      } finally {
        flushing = false;
        if (connectionState === "connected" && queue.length > 0) {
          flushQueue();
        }
      }
    })();
  };

  const enqueue = (channel: string, run: () => Promise<unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      while (queue.length >= maxQueueSize) {
        const dropped = queue.shift();
        if (dropped !== undefined) {
          failQueued(dropped, "queue-full");
        }
      }

      const item: QueuedInvocation = {
        channel,
        createdAt: now(),
        run,
        resolve,
        reject,
        timeoutFiber: undefined,
      };
      item.timeoutFiber = Effect.sleep(Duration.millis(messageTimeoutMs)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (removeQueued(item)) {
              failQueued(item, "expired");
            }
          }),
        ),
        Effect.runFork,
      );

      queue.push(item);
      flushQueue();
    });

  const publishConnectionState = (state: DesktopIpcConnectionState) =>
    Effect.forEach(subscribers, (subscriber) => subscriber(state), { discard: true });

  const setConnectionState = (state: DesktopIpcConnectionState): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (connectionState === state) {
        return;
      }
      connectionState = state;
      yield* publishConnectionState(state);
      flushQueue();
    });

  return DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
      channel,
      handler,
      queueWhenDisconnected = true,
    }: DesktopIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, (_event, raw) =>
            !queueWhenDisconnected ||
            (connectionState === "connected" && queue.length === 0 && !flushing)
              ? runPromise(
                  Effect.gen(function* () {
                    yield* Effect.annotateCurrentSpan({ channel });
                    return yield* handler(raw);
                  }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
                )
              : enqueue(channel, () =>
                  runPromise(
                    Effect.gen(function* () {
                      yield* Effect.annotateCurrentSpan({ channel });
                      return yield* handler(raw);
                    }).pipe(
                      Effect.annotateLogs({ channel }),
                      Effect.withSpan("desktop.ipc.invoke"),
                    ),
                  ),
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

    connectionState: Effect.sync(() => connectionState),
    setConnectionState,
    subscribeConnectionState: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          subscribers.add(listener);
        }).pipe(Effect.andThen(listener(connectionState))),
        () =>
          Effect.sync(() => {
            subscribers.delete(listener);
          }),
      ),
  });
};

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
