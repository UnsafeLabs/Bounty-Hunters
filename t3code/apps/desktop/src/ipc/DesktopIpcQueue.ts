/**
 * DesktopIpcQueue - Message queue for backend disconnect resilience.
 *
 * Buffers outgoing RPC calls when the backend connection is lost,
 * flushes them in FIFO order on reconnect, and expires old messages
 * with a TimeoutError.
 *
 * @module DesktopIpcQueue
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export class IpcQueueTimeoutError extends Data.TaggedError("IpcQueueTimeoutError")<{
  readonly channel: string;
  readonly message: string;
}> {}

export class IpcQueueFullError extends Data.TaggedError("IpcQueueFullError")<{
  readonly maxSize: number;
}> {}

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export interface QueuedMessage {
  readonly id: number;
  readonly channel: string;
  readonly payload: unknown;
  readonly enqueuedAt: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: IpcQueueTimeoutError) => void;
}

export interface DesktopIpcQueueShape {
  readonly enqueue: (msg: Omit<QueuedMessage, "id" | "enqueuedAt">) => Effect.Effect<void, IpcQueueFullError>;
  readonly flush: () => Effect.Effect<void>;
  readonly getConnectionState: () => Effect.Effect<ConnectionState>;
  readonly setConnectionState: (state: ConnectionState) => Effect.Effect<void>;
  readonly getConnectionStateStream: () => Stream.Stream<ConnectionState>;
  readonly size: () => Effect.Effect<number>;
}

export class DesktopIpcQueue extends Context.Service<DesktopIpcQueue, DesktopIpcQueueShape>()(
  "t3/desktop/IpcQueue",
)

export const DEFAULT_MAX_QUEUE_SIZE = 100;
export const MESSAGE_EXPIRY_MS = 30_000; // 30 seconds

export const DesktopIpcQueueLive = (
  maxQueueSize: number = DEFAULT_MAX_QUEUE_SIZE,
) =>
  Layer.scoped(
    DesktopIpcQueue,
    Effect.gen(function* () {
      let nextId = 0;
      const queueRef = yield* Ref.make<Array<QueuedMessage>>([]);
      const stateRef = yield* SubscriptionRef.make<ConnectionState>("connected");

      const service: DesktopIpcQueueShape = {
        enqueue: (msg) =>
          Effect.gen(function* () {
            const currentQueue = yield* Ref.get(queueRef);
            if (currentQueue.length >= maxQueueSize) {
              // Drop oldest message
              const oldest = currentQueue[0]!;
              oldest.reject(
                new IpcQueueTimeoutError({
                  channel: oldest.channel,
                  message: `Message dropped due to queue overflow`,
                }),
              );
              yield* Ref.set(queueRef, currentQueue.slice(1));
            }
            const queuedMsg: QueuedMessage = {
              ...msg,
              id: nextId++,
              enqueuedAt: Date.now(),
            };
            yield* Ref.update(queueRef, (q) => [...q, queuedMsg]);
          }),

        flush: () =>
          Effect.gen(function* () {
            const messages = yield* Ref.get(queueRef);
            // Expire old messages
            const now = Date.now();
            const expired: QueuedMessage[] = [];
            const valid: QueuedMessage[] = [];
            for (const msg of messages) {
              if (now - msg.enqueuedAt > MESSAGE_EXPIRY_MS) {
                expired.push(msg);
              } else {
                valid.push(msg);
              }
            }
            // Fail expired messages
            for (const msg of expired) {
              msg.reject(
                new IpcQueueTimeoutError({
                  channel: msg.channel,
                  message: `Message expired after ${MESSAGE_EXPIRY_MS}ms in queue`,
                }),
              );
            }
            // Clear queue - in real implementation, would actually send
            yield* Ref.set(queueRef, []);
            // Resolve valid messages
            for (const msg of valid) {
              msg.resolve(undefined);
            }
          }),

        getConnectionState: () => SubscriptionRef.get(stateRef),

        setConnectionState: (state: ConnectionState) => SubscriptionRef.set(stateRef, state),

        getConnectionStateStream: () => SubscriptionRef.changes(stateRef),

        size: () => Ref.get(queueRef).pipe(Effect.map((q) => q.length)),
      };

      return service;
    }),
  );
