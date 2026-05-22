```diff
--- /dev/null
+++ b/t3code/packages/effect-codex-app-server/src/CodexStream.ts
@@ -0,0 +1,266 @@
+import * as Effect from "effect/Effect";
+import * as Stream from "effect/Stream";
+import * as Queue from "effect/Queue";
+import * as Fiber from "effect/Fiber";
+import * as Ref from "effect/Ref";
+import * as Option from "effect/Option";
+import * as Cause from "effect/Cause";
+import * as Either from "effect/Either";
+import * as Chunk from "effect/Chunk";
+import * as Duration from "effect/Duration";
+import * as Schedule from "effect/Schedule";
+import { pipe } from "effect/Function";
+
+/**
+ * Configuration for streaming with backpressure and timeouts
+ */
+export interface StreamConfig {
+  /** Maximum time to wait for a chunk before emitting warning (ms) */
+  readonly chunkWarningTimeout: number;
+  /** Maximum time to wait for a chunk before failing (ms) */
+  readonly chunkErrorTimeout: number;
+  /** Queue buffer size for backpressure */
+  readonly bufferSize: number;
+}
+
+export const defaultStreamConfig: StreamConfig = {
+  chunkWarningTimeout: 30000,
+  chunkErrorTimeout: 120000,
+  bufferSize: 16,
+};
+
+/**
+ * Events emitted during streaming
+ */
+export type StreamEvent<A> =
+  | { readonly _tag: "Chunk"; readonly chunk: A }
+  | { readonly _tag: "Warning"; readonly message: string }
+  | { readonly _tag: "Abort" };
+
+/**
+ * Custom errors for streaming operations
+ */
+export class StreamTimeoutError extends Schema.TaggedErrorClass<StreamTimeoutError>()(
+  "StreamTimeoutError",
+  {
+    message: Schema.String,
+  }
+) {
+  override get message() {
+    return this.message;
+  }
+}
+
+export class StreamAbortError extends Schema.TaggedErrorClass<StreamAbortError>()(
+  "StreamAbortError",
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
+ * Creates a backpressured stream from an async iterable with timeout and abort support
+ */
+export function fromAsyncIterable<A>(
+  iterable: AsyncIterable<A>,
+  abortSignal?: AbortSignal
+): Effect.Effect<Stream.Stream<StreamEvent<A>, StreamTimeoutError | StreamAbortError, never>> {
+  return Effect.gen(function* (_) {
+    const queue = yield* _(Queue.bounded<StreamEvent<A>>(defaultStreamConfig.bufferSize));
+    const abortRef = yield* _(Ref.make(false));
+    const fiberRef = yield* _(Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(Option.none()));
+
+    const producer = Effect.gen(function* (_) {
+      const iterator = iterable[Symbol.asyncIterator]();
+
+      while (true) {
+        const isAborted = yield* _(Ref.get(abortRef));
+        if (isAborted) {
+          yield* _(Queue.offer(queue, { _tag: "Abort" as const }));
+          break;
+        }
+
+        const nextResult = yield* _(
+          Effect.promise(() => iterator.next()),
+          Effect.timeoutFail({
+            duration: Duration.millis(defaultStreamConfig.chunkErrorTimeout),
+            onTimeout: () => new StreamTimeoutError({
+              message: `No chunk received within ${defaultStreamConfig.chunkErrorTimeout}ms`,
+            }),
+          }),
+          Effect.catchAll((error) => {
+            if (error instanceof StreamTimeoutError) {
+              return Effect.fail(error);
+            }
+            return Effect.succeed({ done: true, value: undefined });
+          })
+        );
+
+        if (nextResult.done) {
+          break;
+        }
+
+        yield* _(Queue.offer(queue, { _tag: "Chunk" as const, chunk: nextResult.value }));
+      }
+    }).pipe(
+      Effect.catchAll((error) => {
+        if (error instanceof StreamTimeoutError) {
+          return Queue.offer(queue, { _tag: "Chunk" as const, chunk: error as unknown as A });
+        }
+        return Effect.void;
+      }),
+      Effect.fork
+    );
+
+    const fiber = yield* _(producer);
+    yield* _(Ref.set(fiberRef, Option.some(fiber)));
+
+    // Handle abort signal
+    if (abortSignal) {
+      yield* _(
+        Effect.sync(() => {
+          abortSignal.addEventListener("abort", () => {
+            Effect.runFork(
+              Effect.gen(function* (_) {
+                yield* _(Ref.set(abortRef, true));
+                const fib = yield* _(Ref.get(fiberRef));
+                yield* _(Option.match(fib, {
+                  onNone: () => Effect.void,
+                  onSome: (f) => Fiber.interrupt(f),
+                }));
+              })
+            );
+          });
+        })
+      );
+    }
+
+    return Stream.fromQueue(queue).pipe(
+      Stream.map((event) => {
+        if (event._tag === "Abort") {
+          return Stream.fail(new StreamAbortError({ message: "Stream aborted" }));
+        }
+        return Stream.succeed(event);
+      }),
+      Stream.flatMap((s) => s),
+      Stream.takeWhile((event) => event._tag !== "Abort"),
+      Stream.map((event) => {
+        if (event._tag === "Chunk") {
+          return event.chunk;
+        }
+        throw new Error("Unexpected event type");
+      })
+    ) as Stream.Stream<StreamEvent<A>, StreamTimeoutError | StreamAbortError, never>;
+  });
+}
+
+/**
+ * Creates a stream with per-chunk timeout warning and total timeout
+ */
+export function withChunkTimeout<A>(
+  stream: Stream.Stream<A, E, R>
+): Stream.Stream<A, E | StreamTimeoutError, R> {
+  return stream.pipe(
+    Stream.mapEffect((chunk) =>
+      Effect.succeed(chunk).pipe(
+        Effect.timeout(Duration.millis(defaultStreamConfig.chunkWarningTimeout)),
+        Effect.catchAll(() => {
+          // Emit warning but continue
+          return Effect.logWarning(
+            `No chunk received within ${defaultStreamConfig.chunkWarningTimeout}ms, continuing to wait...`
+          ).pipe(
+            Effect.flatMap(() =>
+              Effect.succeed(chunk).pipe(
+                Effect.timeout(
+                  Duration.millis(defaultStreamConfig.chunkErrorTimeout - defaultStreamConfig.chunkWarningTimeout)
+                ),
+                Effect.mapError