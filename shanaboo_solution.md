```diff
--- /dev/null
+++ b/t3code/packages/effect-codex-app-server/src/CodexStream.ts
@@ -0,0 +1,298 @@
+import * as Effect from "effect/Effect";
+import * as Stream from "effect/Stream";
+import * as Queue from "effect/Queue";
+import * as Fiber from "effect/Fiber";
+import * as Ref from "effect/Ref";
+import * as Option from "effect/Option";
+import * as Cause from "effect/Cause";
+import * as Either from "effect/Either";
+import * as Duration from "effect/Duration";
+import * as Schedule from "effect/Schedule";
+import { pipe } from "effect/Function";
+
+/**
+ * Configuration for streaming with backpressure, timeouts, and abort support.
+ */
+export interface CodexStreamConfig {
+  readonly perChunkTimeout: Duration.DurationInput;
+  readonly totalTimeout: Duration.DurationInput;
+  readonly warningTimeout: Duration.DurationInput;
+}
+
+export const defaultCodexStreamConfig: CodexStreamConfig = {
+  perChunkTimeout: "120 seconds",
+  warningTimeout: "30 seconds",
+  totalTimeout: "120 seconds",
+};
+
+/**
+ * Events emitted during streaming.
+ */
+export type StreamEvent<A> =
+  | { readonly _tag: "Chunk"; readonly chunk: A }
+  | { readonly _tag: "Warning"; readonly message: string }
+  | { readonly _tag: "Abort" };
+
+/**
+ * Custom error types for stream failures.
+ */
+export class CodexStreamTimeoutError extends Schema.TaggedErrorClass<CodexStreamTimeoutError>()(
+  "CodexStreamTimeoutError",
+  {
+    message: Schema.String,
+  }
+) {
+  override get message() {
+    return this.message;
+  }
+}
+
+export class CodexStreamAbortError extends Schema.TaggedErrorClass<CodexStreamAbortError>()(
+  "CodexStreamAbortError",
+  {
+    message: Schema.String,
+  }
+) {
+  override get message() {
+    return this.message;
+  }
+}
+
+import * as Schema from "effect/Schema";
+
+/**
+ * Internal state for tracking chunk-level timeouts.
+ */
+interface ChunkTimeoutState {
+  readonly lastChunkTime: number;
+  readonly warningEmitted: boolean;
+}
+
+/**
+ * Creates a backpressured Effect.Stream from an async iterable source.
+ * The stream uses a bounded queue to propagate backpressure to the producer.
+ *
+ * @param source - The async iterable source of chunks
+ * @param config - Stream configuration for timeouts
+ * @param abortSignal - Optional AbortSignal for cancellation
+ * @returns A Stream of chunks with backpressure and timeout handling
+ */
+export const makeBackpressuredStream = <A>(
+  source: AsyncIterable<A>,
+  config: CodexStreamConfig = defaultCodexStreamConfig,
+  abortSignal?: AbortSignal
+): Effect.Effect<Stream.Stream<A, CodexStreamTimeoutError | CodexStreamAbortError>, never, never> =>
+  Effect.gen(function* () {
+    const queue = yield* Queue.bounded<A | StreamEvent<A>>(32);
+    const abortRef = yield* Ref.make(false);
+    const chunkStateRef = yield* Ref.make<ChunkTimeoutState>({
+      lastChunkTime: Date.now(),
+      warningEmitted: false,
+    });
+
+    // Set up abort signal listener
+    if (abortSignal) {
+      yield* Effect.sync(() => {
+        const handler = () => {
+          Effect.runSync(Ref.update(abortRef, () => true));
+          Effect.runSync(Queue.offer(queue, { _tag: "Abort" as const }));
+        };
+        abortSignal.addEventListener("abort", handler, { once: true });
+        return handler;
+      });
+    }
+
+    // Producer fiber that reads from source and writes to queue
+    const producerFiber = yield* Effect.fork(
+      Effect.gen(function* () {
+        try {
+          for await (const chunk of source) {
+            const isAborted = yield* Ref.get(abortRef);
+            if (isAborted) {
+              break;
+            }
+
+            // Update chunk state
+            yield* Ref.set(chunkStateRef, {
+              lastChunkTime: Date.now(),
+              warningEmitted: false,
+            });
+
+            yield* Queue.offer(queue, chunk);
+          }
+        } catch (error) {
+          // Source error, queue will be closed on finally
+        } finally {
+          yield* Queue.shutdown(queue);
+        }
+      }).pipe(
+        Effect.timeout(config.totalTimeout),
+        Effect.catchAll((error) =>
+          Effect.gen(function* () {
+            yield* Queue.offer(queue, {
+              _tag: "Warning" as const,
+              message: `Total timeout exceeded after ${Duration.toMillis(config.totalTimeout)}ms`,
+            });
+            yield* Queue.shutdown(queue);
+          })
+        )
+      )
+    );
+
+    // Chunk timeout monitor fiber
+    const monitorFiber = yield* Effect.fork(
+      Effect.gen(function* () {
+        const warningMillis = Duration.toMillis(config.warningTimeout);
+        const totalMillis = Duration.toMillis(config.totalTimeout);
+
+        while (true) {
+          yield* Effect.sleep("1 second");
+
+          const isAborted = yield* Ref.get(abortRef);
+          if (isAborted) {
+            yield* Queue.offer(queue, { _tag: "Abort" as const });
+            yield* Queue.shutdown(queue);
+            break;
+          }
+
+          const state = yield* Ref.get(chunkStateRef);
+          const elapsed = Date.now() - state.lastChunkTime;
+
+          if (elapsed > totalMillis) {
+            yield* Queue.offer(queue, {
+              _tag: "Warning" as const,
+              message: `Chunk timeout: no data for ${elapsed}ms, exceeding total timeout of ${totalMillis}ms`,
+            });
+            yield* Queue.shutdown(queue);
+            break;
+          }
+
+          if (elapsed > warningMillis && !state.warningEmitted) {
+            yield* Ref.update(chunkStateRef, (s) => ({ ...s, warningEmitted: true }));
+            yield* Queue.offer(queue, {
+              _tag: "Warning" as const,
+              message: `Chunk timeout warning: no data for ${elapsed}ms (warning at ${warningMillis}ms)`,
+            });
+          }
+        }
+      })
+    );
+
+    // Build the stream from the queue
+    const stream = Stream.fromQueue(queue).pipe(
+      Stream.takeWhile((item) => {
+        if (typeof item === "object"