import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ProviderCache, makeProviderCache } from "./ProviderCache.ts";

const providerCacheLayer = Layer.effect(ProviderCache, makeProviderCache);
const testLayer = Layer.merge(providerCacheLayer, TestClock.layer());

describe("ProviderCache", () => {
  it.effect("should return fresh value on cache miss", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      let callCount = 0;

      const result = yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-result";
        }),
      );

      assert.strictEqual(result, "model-result");
      assert.strictEqual(callCount, 1);
    }).pipe(Effect.provide(providerCacheLayer)),
  );

  it.effect("should serve cached value on subsequent calls within TTL", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      let callCount = 0;

      const result1 = yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-result";
        }),
      );

      const result2 = yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-result";
        }),
      );

      assert.strictEqual(result1, "model-result");
      assert.strictEqual(result2, "model-result");
      assert.strictEqual(callCount, 1);
    }).pipe(Effect.provide(providerCacheLayer)),
  );

  it.effect("should call lookup again after TTL expires", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      let callCount = 0;

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-list";
        }),
      );

      yield* TestClock.adjust(Duration.minutes(6));

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-list-refreshed";
        }),
      );

      assert.strictEqual(callCount, 2);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("should cache capabilities and model lists separately", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      const modelCalls: Array<string> = [];
      const capCalls: Array<string> = [];

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          modelCalls.push("model");
          return "model-list";
        }),
      );

      yield* cache.getCapabilities("instance-1", () =>
        Effect.sync(() => {
          capCalls.push("cap");
          return "capabilities";
        }),
      );

      assert.strictEqual(modelCalls.length, 1);
      assert.strictEqual(capCalls.length, 1);

      yield* TestClock.adjust(Duration.minutes(6));

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          modelCalls.push("model");
          return "model-list";
        }),
      );

      const capResult = yield* cache.getCapabilities("instance-1", () =>
        Effect.sync(() => {
          capCalls.push("cap");
          return "capabilities";
        }),
      );

      assert.strictEqual(modelCalls.length, 2);
      assert.strictEqual(capCalls.length, 1);
      assert.strictEqual(capResult, "capabilities");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("should invalidate provider caches", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      let callCount = 0;

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-list";
        }),
      );

      yield* cache.invalidateProvider("instance-1");

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          callCount++;
          return "model-list-2";
        }),
      );

      assert.strictEqual(callCount, 2);
    }).pipe(Effect.provide(providerCacheLayer)),
  );

  it.effect("should separate caches by instance id", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      const calls1: Array<string> = [];
      const calls2: Array<string> = [];

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          calls1.push("a1");
          return "a";
        }),
      );

      yield* cache.getModelList("instance-2", () =>
        Effect.sync(() => {
          calls2.push("b1");
          return "b";
        }),
      );

      yield* cache.getModelList("instance-1", () =>
        Effect.sync(() => {
          calls1.push("a2");
          return "a";
        }),
      );

      yield* cache.getModelList("instance-2", () =>
        Effect.sync(() => {
          calls2.push("b2");
          return "b";
        }),
      );

      assert.strictEqual(calls1.length, 1);
      assert.strictEqual(calls2.length, 1);
    }).pipe(Effect.provide(providerCacheLayer)),
  );

  it.effect("should publish invalidation events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        const fiber = yield* cache.streamInvalidations.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* cache.invalidateProvider("instance-1");
        const events = yield* Fiber.join(fiber);
        assert.strictEqual(Array.from(events)[0], "instance-1");
      }).pipe(Effect.provide(providerCacheLayer)),
    ),
  );
});
