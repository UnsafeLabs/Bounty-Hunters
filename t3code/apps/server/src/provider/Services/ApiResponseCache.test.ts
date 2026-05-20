import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { ApiResponseCache, layer } from "./ApiResponseCache.ts";

describe("ApiResponseCache", () => {
  it.effect("caches and retrieves values by endpoint and key", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      const result1 = yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("cached-response"));
      assert.strictEqual(result1, "cached-response");

      let callCount = 0;
      const result2 = yield* cache.getOrCompute(
        "models",
        "gpt-4",
        Effect.sync(() => {
          callCount++;
          return "fresh-response";
        }),
      );
      assert.strictEqual(result2, "cached-response");
      assert.strictEqual(callCount, 0);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("computes fresh value when cache misses for a different key", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("cached-gpt4"));

      const result = yield* cache.getOrCompute("models", "claude-3", Effect.succeed("fresh-claude3"));
      assert.strictEqual(result, "fresh-claude3");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("uses separate caches per endpoint", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("cached"));

      const result = yield* cache.getOrCompute("status", "gpt-4", Effect.succeed("fresh-status"));
      assert.strictEqual(result, "fresh-status");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("invalidates a specific cache entry", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("cached"));
      yield* cache.invalidate("models", "gpt-4");

      const result = yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("fresh"));
      assert.strictEqual(result, "fresh");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("invalidates all entries for an endpoint", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("cached-1"));
      yield* cache.getOrCompute("models", "claude-3", Effect.succeed("cached-2"));
      yield* cache.invalidateEndpoint("models");

      const result1 = yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("fresh-1"));
      assert.strictEqual(result1, "fresh-1");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("invalidates all endpoints", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("cached"));
      yield* cache.getOrCompute("status", "ready", Effect.succeed("ready"));
      yield* cache.invalidateAll;

      const modelResult = yield* cache.getOrCompute("models", "gpt-4", Effect.succeed("fresh"));
      assert.strictEqual(modelResult, "fresh");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("applies endpoint-specific TTL", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("fast-ttl", "key", Effect.succeed("cached"));

      const result = yield* cache.getOrCompute("fast-ttl", "key", Effect.succeed("fresh"));
      assert.strictEqual(result, "cached");
    }).pipe(
      Effect.provide(
        layer({
          "fast-ttl": { timeToLive: Duration.seconds(30), capacity: 10 },
        }),
      ),
    ),
  );

  it.effect("refreshes expired entries", () =>
    Effect.gen(function* () {
      const cache = yield* ApiResponseCache;
      yield* cache.getOrCompute("fast-ttl", "key", Effect.succeed("cached"));
      yield* Effect.sleep(Duration.millis(50));

      const result = yield* cache.getOrCompute("fast-ttl", "key", Effect.succeed("fresh"));
      assert.strictEqual(result, "fresh");
    }).pipe(
      Effect.provide(
        layer({
          "fast-ttl": { timeToLive: Duration.millis(30), capacity: 10 },
        }),
      ),
    ),
  );
});
