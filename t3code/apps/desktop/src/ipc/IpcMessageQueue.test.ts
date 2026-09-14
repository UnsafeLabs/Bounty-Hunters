import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as IpcMessageQueue from "./IpcMessageQueue.ts";

function makeQueue(options?: IpcMessageQueue.IpcMessageQueueOptions) {
  return new IpcMessageQueue.IpcMessageQueue(options);
}

const waitForSize = (queue: IpcMessageQueue.IpcMessageQueue, expected: number) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((yield* queue.size) === expected) {
        return;
      }
      yield* Effect.yieldNow();
    }
    assert.equal(yield* queue.size, expected);
  });

describe("IpcMessageQueue", () => {
  it.effect("bypasses the queue when the connection is healthy", () =>
    Effect.gen(function* () {
      const queue = makeQueue();
      const executed: Array<string> = [];

      const result = yield* queue.call(
        "desktop:get-client-settings",
        Effect.sync(() => {
          executed.push("direct");
          return "settings";
        }),
      );

      assert.equal(result, "settings");
      assert.deepEqual(executed, ["direct"]);
      assert.equal(yield* queue.size, 0);
    }),
  );

  it.effect("queues calls while disconnected and flushes FIFO on reconnect", () =>
    Effect.gen(function* () {
      const queue = makeQueue();
      const delivered: Array<string> = [];
      yield* queue.markDisconnected();

      const first = yield* Effect.fork(
        queue.call(
          "channel-a",
          Effect.sync(() => {
            delivered.push("a");
            return "a";
          }),
        ),
      );
      const second = yield* Effect.fork(
        queue.call(
          "channel-b",
          Effect.sync(() => {
            delivered.push("b");
            return "b";
          }),
        ),
      );
      const third = yield* Effect.fork(
        queue.call(
          "channel-c",
          Effect.sync(() => {
            delivered.push("c");
            return "c";
          }),
        ),
      );
      yield* waitForSize(queue, 3);
      assert.deepEqual(delivered, []);

      const flushed = yield* queue.reconnect();
      assert.equal(flushed, 3);
      assert.deepEqual(delivered, ["a", "b", "c"]);
      assert.equal(yield* Fiber.join(first), "a");
      assert.equal(yield* Fiber.join(second), "b");
      assert.equal(yield* Fiber.join(third), "c");
      assert.equal(yield* queue.size, 0);

      // Queue is drained: new messages are sent directly again.
      const after = yield* queue.call("channel-d", Effect.succeed("d"));
      assert.equal(after, "d");
      assert.equal(yield* queue.size, 0);
    }),
  );

  it.effect("drops the oldest message when the queue is full", () =>
    Effect.gen(function* () {
      const queue = makeQueue({ maxSize: 2 });
      yield* queue.markDisconnected();

      const oldest = yield* Effect.fork(queue.call("oldest", Effect.succeed("oldest")));
      const middle = yield* Effect.fork(queue.call("middle", Effect.succeed("middle")));
      yield* waitForSize(queue, 2);

      const newest = yield* Effect.fork(queue.call("newest", Effect.succeed("newest")));
      yield* waitForSize(queue, 2);

      const oldestError = yield* Fiber.join(oldest).pipe(Effect.flip);
      assert.instanceOf(oldestError, IpcMessageQueue.IpcTimeoutError);
      assert.equal(oldestError.reason, "overflow");

      const flushed = yield* queue.reconnect();
      assert.equal(flushed, 2);
      assert.equal(yield* Fiber.join(middle), "middle");
      assert.equal(yield* Fiber.join(newest), "newest");
    }),
  );

  it.effect("fails queued callers with TimeoutError after 30 seconds", () =>
    Effect.gen(function* () {
      const queue = makeQueue();
      yield* queue.markDisconnected();

      const fiber = yield* Effect.fork(queue.call("stale-channel", Effect.succeed("late")));
      yield* waitForSize(queue, 1);

      yield* TestClock.adjust(Duration.seconds(30));
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);

      assert.instanceOf(error, IpcMessageQueue.IpcTimeoutError);
      assert.equal(error.channel, "stale-channel");
      assert.equal(error.reason, "expired");
      assert.equal(yield* queue.size, 0);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("sweepExpired fails stale messages without a reconnect", () =>
    Effect.gen(function* () {
      const queue = makeQueue();
      yield* queue.markDisconnected();

      const fiber = yield* Effect.fork(queue.call("sweep-channel", Effect.succeed("late")));
      yield* waitForSize(queue, 1);

      yield* TestClock.adjust(Duration.seconds(31));
      const expired = yield* queue.sweepExpired();
      assert.equal(expired, 1);
      assert.equal(yield* queue.size, 0);

      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      assert.instanceOf(error, IpcMessageQueue.IpcTimeoutError);
      assert.equal(error.reason, "expired");
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("emits connected, disconnected, and reconnecting states", () =>
    Effect.gen(function* () {
      const queue = makeQueue();
      const seen = yield* Ref.make<ReadonlyArray<IpcMessageQueue.IpcConnectionState>>([]);

      const unsubscribe = yield* queue.subscribeEffect((state) =>
        Effect.runSync(Ref.update(seen, (current) => [...current, state])),
      );

      yield* queue.markDisconnected();
      yield* queue.markReconnecting();
      yield* queue.markConnected();

      assert.deepEqual(yield* Ref.get(seen), [
        "connected",
        "disconnected",
        "reconnecting",
        "connected",
      ]);
      yield* Effect.sync(unsubscribe);
    }),
  );
});
