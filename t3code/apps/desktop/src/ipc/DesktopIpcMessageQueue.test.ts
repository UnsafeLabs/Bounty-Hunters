import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopIpcMessageQueue from "./DesktopIpcMessageQueue.ts";

describe("DesktopIpcMessageQueue", () => {
  it.effect("runs messages immediately while connected without buffering them", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make({ initialConnectionState: "connected" });
      const runs = yield* Ref.make(0);

      const result = yield* queue.enqueue(
        "settings",
        Ref.update(runs, (count) => count + 1).pipe(Effect.as("ok")),
      );

      assert.equal(result, "ok");
      assert.equal(yield* Ref.get(runs), 1);
      assert.equal(yield* queue.size, 0);
      assert.equal(yield* queue.connectionState, "connected");
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("buffers messages while disconnected and flushes them on reconnect", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make();
      const runs = yield* Ref.make(0);

      const fiber = yield* queue
        .enqueue("settings", Ref.update(runs, (count) => count + 1).pipe(Effect.as("ok")))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.equal(yield* queue.size, 1);
      assert.equal(yield* Ref.get(runs), 0);

      yield* queue.setConnectionState("connected");

      assert.equal(yield* Fiber.join(fiber), "ok");
      assert.equal(yield* Ref.get(runs), 1);
      assert.equal(yield* queue.size, 0);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("buffers messages while reconnecting", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make({ initialConnectionState: "reconnecting" });

      const fiber = yield* queue
        .enqueue("settings", Effect.succeed("ok"))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.equal(yield* queue.size, 1);

      yield* queue.setConnectionState("connected");
      assert.equal(yield* Fiber.join(fiber), "ok");
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("expires a buffered message with a typed error after the timeout", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make({ messageTtl: Duration.seconds(30) });
      const runs = yield* Ref.make(0);

      const fiber = yield* queue
        .enqueue("settings", Ref.update(runs, (count) => count + 1))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(30));

      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      assert.instanceOf(error, DesktopIpcMessageQueue.IpcMessageTimeoutError);
      if (error instanceof DesktopIpcMessageQueue.IpcMessageTimeoutError) {
        assert.equal(error.channel, "settings");
        assert.equal(error.timeoutMillis, 30_000);
      }
      assert.equal(yield* Ref.get(runs), 0);
      assert.equal(yield* queue.size, 0);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("does not expire a buffered message before the timeout elapses", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make({ messageTtl: Duration.seconds(30) });

      const fiber = yield* queue
        .enqueue("settings", Effect.succeed("ok"))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(29));
      assert.equal(yield* queue.size, 1);

      yield* queue.setConnectionState("connected");
      assert.equal(yield* Fiber.join(fiber), "ok");
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("drops the oldest buffered message when the queue is at capacity", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make({ capacity: 2 });

      const first = yield* queue.enqueue("a", Effect.succeed("a")).pipe(Effect.forkScoped);
      const second = yield* queue.enqueue("b", Effect.succeed("b")).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.equal(yield* queue.size, 2);

      // Admitting a third message while full evicts the oldest ("a") and keeps the
      // newest two ("b", "c"), so the queue stays at capacity in FIFO order. The
      // eviction atomically admits "c", so once "a" fails the queue already holds
      // exactly ["b", "c"].
      const third = yield* queue.enqueue("c", Effect.succeed("c")).pipe(Effect.forkScoped);

      const error = yield* Fiber.join(first).pipe(Effect.flip);
      assert.instanceOf(error, DesktopIpcMessageQueue.IpcMessageQueueOverflowError);
      if (error instanceof DesktopIpcMessageQueue.IpcMessageQueueOverflowError) {
        assert.equal(error.channel, "a");
        assert.equal(error.capacity, 2);
      }
      assert.equal(yield* queue.size, 2);

      yield* queue.setConnectionState("connected");
      assert.equal(yield* Fiber.join(second), "b");
      assert.equal(yield* Fiber.join(third), "c");
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("caps the buffer at the default capacity of 100, dropping the oldest message", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make();

      // Fill the buffer to the default capacity of 100, naming the two oldest
      // messages so the overflow assertions stay free of array indexing.
      const oldest = yield* queue.enqueue("ch-0", Effect.succeed(0)).pipe(Effect.forkScoped);
      const secondOldest = yield* queue.enqueue("ch-1", Effect.succeed(1)).pipe(Effect.forkScoped);
      for (let index = 2; index < 100; index += 1) {
        yield* queue.enqueue(`ch-${index}`, Effect.succeed(index)).pipe(Effect.forkScoped);
      }
      yield* Effect.yieldNow;
      assert.equal(yield* queue.size, 100);

      // The 101st message overflows the queue: it evicts the oldest buffered
      // message ("ch-0") and is admitted in its place, so the queue stays at 100.
      const overflowing = yield* queue
        .enqueue("ch-100", Effect.succeed(100))
        .pipe(Effect.forkScoped);

      const error = yield* Fiber.join(oldest).pipe(Effect.flip);
      assert.instanceOf(error, DesktopIpcMessageQueue.IpcMessageQueueOverflowError);
      if (error instanceof DesktopIpcMessageQueue.IpcMessageQueueOverflowError) {
        assert.equal(error.channel, "ch-0");
        assert.equal(error.capacity, 100);
      }
      assert.equal(yield* queue.size, 100);

      yield* queue.setConnectionState("connected");
      // The second-oldest message is now the head and the newest one survived.
      assert.equal(yield* Fiber.join(secondOldest), 1);
      assert.equal(yield* Fiber.join(overflowing), 100);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("flushes buffered messages in first-in-first-out order", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make();
      const order: string[] = [];

      const first = yield* queue
        .enqueue("a", Effect.sync(() => order.push("a")))
        .pipe(Effect.forkScoped);
      const second = yield* queue
        .enqueue("b", Effect.sync(() => order.push("b")))
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.equal(yield* queue.size, 2);

      yield* queue.setConnectionState("connected");
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.deepEqual(order, ["a", "b"]);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("notifies subscribers of distinct connection-state transitions only", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcMessageQueue.make();
      const events: DesktopIpcMessageQueue.IpcConnectionState[] = [];

      const unsubscribe = yield* queue.subscribe((state) => {
        events.push(state);
      });

      yield* queue.setConnectionState("reconnecting");
      yield* queue.setConnectionState("connected");
      yield* queue.setConnectionState("connected");
      assert.equal(yield* queue.connectionState, "connected");

      unsubscribe();
      yield* queue.setConnectionState("disconnected");

      assert.deepEqual(events, ["reconnecting", "connected"]);
      assert.equal(yield* queue.connectionState, "disconnected");
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});
