import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  DesktopIpcQueue,
  DesktopIpcQueueLive,
  DEFAULT_MAX_QUEUE_SIZE,
  MESSAGE_EXPIRY_MS,
  IpcQueueTimeoutError,
  IpcQueueFullError,
  type ConnectionState,
  type QueuedMessage,
} from "./DesktopIpcQueue.ts";

describe("DesktopIpcQueue", () => {
  const TestLayer = DesktopIpcQueueLive(DEFAULT_MAX_QUEUE_SIZE);

  it.effect("starts with empty queue", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcQueue;
      const size = yield* queue.size();
      assert.equal(size, 0);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("enqueues messages and reports size", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcQueue;
      yield* queue.enqueue({
        channel: "test.channel",
        payload: { data: "hello" },
        resolve: () => {},
        reject: () => {},
      });
      yield* queue.enqueue({
        channel: "test.channel",
        payload: { data: "world" },
        resolve: () => {},
        reject: () => {},
      });
      const size = yield* queue.size();
      assert.equal(size, 2);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("tracks connection state changes", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcQueue;
      const state1 = yield* queue.getConnectionState();
      assert.equal(state1, "connected");

      yield* queue.setConnectionState("disconnected");
      const state2 = yield* queue.getConnectionState();
      assert.equal(state2, "disconnected");

      yield* queue.setConnectionState("reconnecting");
      const state3 = yield* queue.getConnectionState();
      assert.equal(state3, "reconnecting");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("flush clears the queue", () =>
    Effect.gen(function* () {
      const queue = yield* DesktopIpcQueue;
      const resolved: string[] = [];
      yield* queue.enqueue({
        channel: "test.a",
        payload: {},
        resolve: () => { resolved.push("a"); },
        reject: () => {},
      });
      yield* queue.enqueue({
        channel: "test.b",
        payload: {},
        resolve: () => { resolved.push("b"); },
        reject: () => {},
      });

      assert.equal((yield* queue.size()), 2);
      yield* queue.flush();
      assert.equal((yield* queue.size()), 0);
      assert.deepStrictEqual(resolved, ["a", "b"]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("drops oldest message when queue is full", () =>
    Effect.gen(function* () {
      const queue = DesktopIpcQueueLive(2);
      const rejected: string[] = [];

      yield* Effect.gen(function* () {
        const q = yield* DesktopIpcQueue;
        yield* q.enqueue({
          channel: "ch.1",
          payload: {},
          resolve: () => {},
          reject: () => { rejected.push("1"); },
        });
        yield* q.enqueue({
          channel: "ch.2",
          payload: {},
          resolve: () => {},
          reject: () => {},
        });
        // This should evict ch.1
        yield* q.enqueue({
          channel: "ch.3",
          payload: {},
          resolve: () => {},
          reject: () => {},
        });
        const size = yield* q.size();
        assert.equal(size, 2);
      }).pipe(Effect.provide(queue));

      assert.deepStrictEqual(rejected, ["1"]);
    }),
  );
});
