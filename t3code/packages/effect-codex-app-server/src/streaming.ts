import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as CodexError from "./errors.ts";
import * as CodexProtocol from "./protocol.ts";

/**
 * Streaming options for Codex requests that return large responses.
 */
export interface CodexStreamingOptions {
  /**
   * Warning timeout per chunk. If a chunk takes longer than this, a warning is logged.
   * @default 30 seconds
   */
  readonly chunkWarningTimeout?: Duration.Duration;

  /**
   * Failure timeout per chunk. If a chunk takes longer than this, the stream fails.
   * @default 120 seconds
   */
  readonly chunkFailTimeout?: Duration.Duration;

  /**
   * Abort signal to cancel the streaming request.
   */
  readonly abortSignal?: AbortSignal;
}

const DEFAULT_CHUNK_WARNING_TIMEOUT = Duration.seconds(30);
const DEFAULT_CHUNK_FAIL_TIMEOUT = Duration.seconds(120);

/**
 * Streaming response for Codex requests that yield multiple chunks.
 * Provides backpressure handling and per-chunk timeout monitoring.
 */
export interface CodexStreamingResponse<A> {
  readonly stream: Stream.Stream<A, CodexError.CodexAppServerError>;
  readonly fiber: Fiber.Fiber<void, never>;
  readonly abortController: AbortController;
}

/**
 * Selects diff chunks from turn/diff/updated notifications.
 */
export const selectDiffChunk = (
  notification: CodexProtocol.CodexAppServerIncomingNotification,
): ReadonlyArray<string> | undefined => {
  if (notification.method === "turn/diff/updated") {
    const params = notification.params as
      | { readonly diffs?: ReadonlyArray<{ readonly text?: string }> }
      | undefined;
    return params?.diffs?.map((d) => d.text ?? "").filter(Boolean) ?? [];
  }
  return undefined;
};

/**
 * Selects agent message deltas from item/agentMessage/delta notifications.
 */
export const selectMessageDelta = (
  notification: CodexProtocol.CodexAppServerIncomingNotification,
): string | undefined => {
  if (notification.method === "item/agentMessage/delta") {
    const params = notification.params as { readonly delta?: string } | undefined;
    return params?.delta;
  }
  return undefined;
};

/**
 * Wraps a stream with backpressure and per-chunk timeout monitoring.
 * Emits warnings at chunkWarningTimeout and fails at chunkFailTimeout.
 */
export const withStreaming = <A>(
  options: CodexStreamingOptions = {},
) => {
  const warningTimeout = options.chunkWarningTimeout ?? DEFAULT_CHUNK_WARNING_TIMEOUT;
  const failTimeout = options.chunkFailTimeout ?? DEFAULT_CHUNK_FAIL_TIMEOUT;

  return <R>(
    stream: Stream.Stream<A, CodexError.CodexAppServerError, R>,
  ): Effect.Effect<
    CodexStreamingResponse<A>,
    CodexError.CodexAppServerError,
    R | Scope.Scope
  > =>
    Effect.gen(function* () {
      const abortController = new AbortController();

      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abortController.abort();
        } else {
          options.abortSignal.addEventListener("abort", () => {
            abortController.abort();
          });
        }
      }

      const chunkQueue = yield* Queue.unbounded<A>();
      const startTime = yield* Clock.currentTimeMillis;
      const lastChunkRef = yield* Ref.make(startTime);

      const warningTimeoutMs = Duration.toMillis(warningTimeout);
      const failTimeoutMs = Duration.toMillis(failTimeout);

      // Timeout monitor fiber
      const timeoutFiber = Effect.gen(function* () {
        while (true) {
          if (abortController.signal.aborted) {
            return;
          }
          yield* Effect.sleep(Duration.seconds(1));
          if (abortController.signal.aborted) {
            return;
          }
          const currentTime = yield* Clock.currentTimeMillis;
          const lastChunkTime = yield* Ref.get(lastChunkRef);
          const sinceLastChunk = currentTime - lastChunkTime;
          if (sinceLastChunk >= failTimeoutMs) {
            yield* Effect.logWarning(
              `Streaming timed out: no chunk for ${sinceLastChunk}ms`,
            );
            abortController.abort();
            return;
          }
          if (sinceLastChunk >= warningTimeoutMs) {
            yield* Effect.logDebug(
              `Chunk delayed: ${sinceLastChunk}ms (warning at ${warningTimeoutMs}ms)`,
            );
          }
        }
      }).pipe(Effect.forkScoped);

      // Stream runner - feeds chunks into queue and updates lastChunkRef
      const streamFiber = stream.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            yield* Queue.offer(chunkQueue, chunk);
            yield* Ref.set(lastChunkRef, yield* Clock.currentTimeMillis);
          }),
        ),
        Effect.catchCause(() => Effect.unit),
        Effect.forkScoped,
      );

      // Wait for both fibers, then interrupt them together
      const fiber = Effect.gen(function* () {
        const tf = yield* timeoutFiber;
        const sf = yield* streamFiber;
        yield* Fiber.interruptAll([tf, sf]);
      }).pipe(Effect.forkScoped);

      const outputStream = Stream.fromQueue(chunkQueue);

      return {
        stream: outputStream,
        fiber: yield* fiber,
        abortController,
      };
    });
};

/**
 * Options for streaming a Codex request.
 */
export interface CodexRequestStreamOptions extends CodexStreamingOptions {
  readonly notificationMethod?: string;
  readonly selector?: (
    notification: CodexProtocol.CodexAppServerIncomingNotification,
  ) => string | undefined;
}

/**
 * Creates a streaming request that yields chunks as notifications arrive.
 * Combines backpressure, per-chunk timeouts, and abort signal support.
 */
export const requestStream = (
  _method: string,
  _payload: unknown,
  options: CodexRequestStreamOptions = {},
) => {
  return <R>(
    client: CodexProtocol.CodexAppServerPatchedProtocol,
  ): Effect.Effect<
    CodexStreamingResponse<string>,
    CodexError.CodexAppServerError,
    R | Scope.Scope
  > =>
    Effect.gen(function* () {
      const abortController = new AbortController();

      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abortController.abort();
        } else {
          options.abortSignal.addEventListener("abort", () => {
            abortController.abort();
          });
        }
      }

      const chunkQueue = yield* Queue.unbounded<string>();
      const startTime = yield* Clock.currentTimeMillis;
      const lastChunkRef = yield* Ref.make(startTime);

      const warningTimeoutMs = Duration.toMillis(
        options.chunkWarningTimeout ?? DEFAULT_CHUNK_WARNING_TIMEOUT,
      );
      const failTimeoutMs = Duration.toMillis(
        options.chunkFailTimeout ?? DEFAULT_CHUNK_FAIL_TIMEOUT,
      );

      const timeoutFiber = Effect.gen(function* () {
        while (true) {
          if (abortController.signal.aborted) {
            return;
          }
          yield* Effect.sleep(Duration.seconds(1));
          if (abortController.signal.aborted) {
            return;
          }
          const currentTime = yield* Clock.currentTimeMillis;
          const lastChunkTime = yield* Ref.get(lastChunkRef);
          const sinceLastChunk = currentTime - lastChunkTime;
          if (sinceLastChunk >= failTimeoutMs) {
            yield* Effect.logWarning(
              `Streaming timed out: no chunk received for ${sinceLastChunk}ms`,
            );
            abortController.abort();
            return;
          }
          if (sinceLastChunk >= warningTimeoutMs) {
            yield* Effect.logDebug(
              `Chunk delayed: ${sinceLastChunk}ms (warning at ${warningTimeoutMs}ms)`,
            );
          }
        }
      }).pipe(Effect.forkScoped);

      const selector = options.selector;
      const notificationMethod = options.notificationMethod;

      const notificationFiber = Stream.runForEach(
        client.incomingNotifications,
        (notification: CodexProtocol.CodexAppServerIncomingNotification) => {
          if (notificationMethod && notification.method !== notificationMethod) {
            return Effect.asVoid(Effect.unit);
          }
          const item = selector ? selector(notification) : undefined;
          if (item === undefined) {
            return Effect.asVoid(Effect.unit);
          }
          return Effect.asVoid(Queue.offer(chunkQueue, item));
        },
      ).pipe(
        Effect.catchCause(() => Effect.asVoid(Effect.unit)),
        Effect.forkScoped,
      );

      const fiber = Effect.gen(function* () {
        const tf = yield* timeoutFiber;
        const nf = yield* notificationFiber;
        yield* Fiber.interruptAll([tf, nf]);
      }).pipe(Effect.forkScoped);

      const outputStream = Stream.fromQueue(chunkQueue);

      return {
        stream: outputStream,
        fiber: yield* fiber,
        abortController,
      };
    });
};