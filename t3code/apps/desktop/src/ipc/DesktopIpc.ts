import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";

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
  readonly connectionState: SubscriptionRef.SubscriptionRef<DesktopIpcConnectionState>;
  readonly flushQueue: Effect.Effect<void>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()("t3/desktop/Ipc") {}

export type DesktopIpcConnectionState = "connected" | "disconnected" | "reconnecting";

export class DesktopIpcQueueTimeoutError extends Data.TaggedError("DesktopIpcQueueTimeoutError")<{
  readonly channel: string;
  readonly ageMillis: number;
}> {
  override get message() {
    return `Queued IPC call on ${this.channel} expired after ${this.ageMillis}ms.`;
  }
}

export class DesktopIpcQueueOverflowError extends Data.TaggedError("DesktopIpcQueueOverflowError")<{
  readonly channel: string;
  readonly maxSize: number;
}> {
  override get message() {
    return `Queued IPC call on ${this.channel} was dropped because the queue exceeded ${this.maxSize} messages.`;
  }
}

export interface DesktopIpcQueueOptions {
  readonly backendReady?: Ref.Ref<boolean> | undefined;
  readonly maxSize?: number | undefined;
  readonly messageTtl?: Duration.Input | undefined;
  readonly pollInterval?: Duration.Input | undefined;
}

interface QueuedIpcCall {
  readonly channel: string;
  readonly enqueuedAt: number;
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const now = () => Date.now();

export const make = (ipcMain: DesktopIpcMain, options: DesktopIpcQueueOptions = {}): DesktopIpcShape => {
  const maxSize = options.maxSize ?? 100;
  const messageTtlMs = Duration.toMillis(Duration.fromInputUnsafe(options.messageTtl ?? "30 seconds"));
  const pollIntervalMs = Duration.toMillis(
    Duration.fromInputUnsafe(options.pollInterval ?? "100 millis"),
  );
  const connectionState = Effect.runSync(SubscriptionRef.make<DesktopIpcConnectionState>("connected"));
  const queue: QueuedIpcCall[] = [];
  let flushing: Promise<void> | undefined;

  const setConnectionState = (state: DesktopIpcConnectionState) => {
    if (SubscriptionRef.getUnsafe(connectionState) !== state) {
      Effect.runSync(SubscriptionRef.set(connectionState, state));
    }
  };

  const isBackendReady = async () =>
    options.backendReady === undefined ? true : await Effect.runPromise(Ref.get(options.backendReady));

  const failExpired = () => {
    const timestamp = now();
    for (let index = queue.length - 1; index >= 0; index--) {
      const item = queue[index]!;
      const ageMillis = timestamp - item.enqueuedAt;
      if (ageMillis >= messageTtlMs) {
        queue.splice(index, 1);
        clearTimeout(item.timeout);
        item.reject(new DesktopIpcQueueTimeoutError({ channel: item.channel, ageMillis }));
      }
    }
  };

  const flushQueue = async () => {
    if (flushing !== undefined) {
      return flushing;
    }

    flushing = (async () => {
      try {
        if (!(await isBackendReady())) {
          setConnectionState(queue.length === 0 ? "disconnected" : "reconnecting");
          return;
        }

        setConnectionState("connected");
        while (queue.length > 0) {
          failExpired();
          const item = queue.shift();
          if (item === undefined) {
            continue;
          }

          clearTimeout(item.timeout);
          try {
            item.resolve(await item.run());
          } catch (error) {
            item.reject(error);
          }
        }
      } finally {
        flushing = undefined;
      }
    })();

    return flushing;
  };

  const enqueue = (channel: string, run: () => Promise<unknown>) => {
    setConnectionState("reconnecting");
    return new Promise<unknown>((resolve, reject) => {
      const enqueuedAt = now();
      const timeout = setTimeout(() => {
        const index = queue.findIndex((item) => item.timeout === timeout);
        if (index >= 0) {
          queue.splice(index, 1);
        }
        reject(new DesktopIpcQueueTimeoutError({ channel, ageMillis: now() - enqueuedAt }));
      }, messageTtlMs);

      queue.push({ channel, enqueuedAt, run, resolve, reject, timeout });

      while (queue.length > maxSize) {
        const dropped = queue.shift()!;
        clearTimeout(dropped.timeout);
        dropped.reject(new DesktopIpcQueueOverflowError({ channel: dropped.channel, maxSize }));
      }
    });
  };

  const dispatch = async (channel: string, run: () => Promise<unknown>) => {
    failExpired();
    if ((await isBackendReady()) && queue.length === 0) {
      setConnectionState("connected");
      return run();
    }

    const queued = enqueue(channel, run);
    if (await isBackendReady()) {
      await flushQueue();
    }
    return queued;
  };

  if (options.backendReady !== undefined) {
    setInterval(() => {
      void flushQueue();
    }, pollIntervalMs).unref?.();
  }

  return DesktopIpc.of({
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
            dispatch(channel, () =>
              runPromise(
                Effect.gen(function* () {
                  yield* Effect.annotateCurrentSpan({ channel });
                  return yield* handler(raw);
                }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
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
    connectionState,
    flushQueue: Effect.promise(() => flushQueue()),
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
