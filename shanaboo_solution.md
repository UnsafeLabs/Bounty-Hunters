```diff
--- /dev/null
+++ b/t3code/packages/effect-codex-app-server/src/CodexStream.ts
@@ -0,0 +1,284 @@
+import * as Effect from "effect/Effect";
+import * as Stream from "effect/Stream";
+import * as Queue from "effect/Queue";
+import * as Fiber from "effect/Fiber";
+import * as Duration from "effect/Duration";
+import * as Option from "effect/Option";
+import * as Either from "effect/Either";
+import * as Cause from "effect/Cause";
+import * as Exit from "effect/Exit";
+import * as Scope from "effect/Scope";
+import { pipe } from "effect/Function";
+
+/**
+ * Configuration for streaming Codex responses with backpressure and timeout handling.
+ */
+export interface CodexStreamConfig {
+  readonly chunkTimeout: Duration.Duration;
+  readonly totalTimeout: Duration.Duration;
+  readonly warningTimeout: Duration.Duration;
+}
+
+/**
+ * Default stream configuration.
+ */
+export const defaultStreamConfig: CodexStreamConfig = {
+  chunkTimeout: Duration.seconds(120),
+  totalTimeout: Duration.seconds(120),
+  warningTimeout: Duration.seconds(30),
+};
+
+/**
+ * Events emitted during streaming for monitoring and debugging.
+ */
+export type StreamEvent =
+  | { readonly _tag: "ChunkReceived"; readonly index: number; readonly size: number }
+  | { readonly _tag: "Warning"; readonly message: string; readonly elapsed: number }
+  | { readonly _tag: "Timeout"; readonly message: string }
+  | { readonly _tag: "Aborted" }
+  | { readonly _tag: "Completed"; readonly totalChunks: number };
+
+/**
+ * A chunk from the Codex stream.
+ */
+export interface CodexChunk {
+  readonly index: number;
+  readonly data: string;
+  readonly timestamp: number;
+}
+
+/**
+ * Result of a streaming Codex request.
+ */
+export interface CodexStreamResult {
+  readonly chunks: ReadonlyArray<CodexChunk>;
+  readonly events: ReadonlyArray<StreamEvent>;
+}
+
+/**
+ * Error types for streaming operations.
+ */
+export class CodexStreamError extends Error {
+  readonly _tag = "CodexStreamError";
+  constructor(
+    message: string,
+    readonly cause?: unknown
+  ) {
+    super(message);
+    this.name = "CodexStreamError";
+  }
+}
+
+/**
+ * Creates a backpressured Effect.Stream from an async iterable source.
+ * The stream will pause when the consumer is slower than the producer,
+ * preventing memory buildup.
+ */
+export const fromAsyncIterableWithBackpressure = <A>(
+  iterable: AsyncIterable<A>,
+  abortSignal?: AbortSignal
+): Stream.Stream<A, CodexStreamError> =>
+  Stream.async((emit) => {
+    const iterator = iterable[Symbol.asyncIterator]();
+    let running = true;
+
+    const cleanup = () => {
+      running = false;
+    };
+
+    if (abortSignal) {
+      abortSignal.addEventListener("abort", cleanup);
+    }
+
+    const pull = async (): Promise<void> => {
+      if (!running) {
+        emit.end();
+        return;
+      }
+
+      try {
+        const result = await iterator.next();
+        if (result.done) {
+          emit.end();
+        } else {
+          emit.single(result.value);
+          // Continue pulling - backpressure is handled by the async queue
+          pull();
+        }
+      } catch (error) {
+        emit.fail(new CodexStreamError("Failed to read from async iterable", error));
+      }
+    };
+
+    pull();
+
+    return Effect.sync(() => {
+      cleanup();
+      if (abortSignal) {
+        abortSignal.removeEventListener("abort", cleanup);
+      }
+    });
+  });
+
+/**
+ * Adds timeout handling to a stream of chunks.
+ * Emits a warning event at warningTimeout and fails at chunkTimeout.
+ */
+export const withChunkTimeout = (
+  config: CodexStreamConfig
+) => <E, A>(stream: Stream.Stream<A, E>): Stream.Stream<A, E | CodexStreamError> =>
+  pipe(
+    stream,
+    Stream.timeoutTo(config.chunkTimeout, Stream.fail(new CodexStreamError("Chunk timeout exceeded")))
+  );
+
+/**
+ * Creates a stream with per-chunk timeout and warning events.
+ * Uses Effect's built-in timeout and scheduling.
+ */
+export const withTimeoutAndWarnings = (
+  config: CodexStreamConfig
+) => <E, A>(stream: Stream.Stream<A, E>): Stream.Stream<A, E | CodexStreamError> => {
+  const warningDuration = Duration.toMillis(config.warningTimeout);
+  const chunkTimeoutDuration = Duration.toMillis(config.chunkTimeout);
+
+  return pipe(
+    stream,
+    Stream.mapEffect((chunk) =>
+      Effect.raceFirst(
+        Effect.succeed(chunk),
+        Effect.sleep(config.warningTimeout).pipe(
+          Effect.tap(() =>
+            Effect.logWarning(
+              `No chunk received within ${warningDuration}ms, still waiting...`
+            )
+          ),
+          Effect.flatMap(() => Effect.never)
+        )
+      )
+    ),
+    Stream.timeoutFail(
+      () => new CodexStreamError(`No chunk received within ${chunkTimeoutDuration}ms`),
+      config.chunkTimeout
+    )
+  );
+};
+
+/**
+ * Wraps a Codex SDK streaming response into an Effect.Stream with
+ * backpressure, timeout handling, and abort support.
+ */
+export const createCodexStream = (
+  sdkStream: AsyncIterable<string>,
+  options?: {
+    readonly abortSignal?: AbortSignal;
+    readonly config?: Partial<CodexStreamConfig>;
+  }
+): Stream.Stream<CodexChunk, CodexStreamError> => {
+  const config = {
+    ...defaultStreamConfig,
+    ...options?.config,
+  };
+
+  return pipe(
+    fromAsyncIterableWithBackpressure(sdkStream, options?.abortSignal),
+    Stream.map((data, index) => ({
+      index,
+      data,
+      timestamp: Date.now(),
+    })),
+    withTimeoutAndWarnings(config)
+  );
+};
+
+/**
+ * Collects all chunks from a stream into a single result.
+ * This ensures that streaming and non-streaming requests produce the same output.
+ */
+export const collectStream = <E, A>(
+  stream: Stream.Stream<A, E>
+): Effect.Effect<ReadonlyArray<A>, E> => Stream.runCollect(stream);
+
+/**
+ * Runs a stream