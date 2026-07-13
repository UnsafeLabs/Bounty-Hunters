import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Metric from "effect/Metric";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { makeProviderApiCache } from "./ProviderCache.ts";

const hasMetricSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
) =>
  snapshots.some(
    (snapshot) =>
      snapshot.id === id &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );

describe("ProviderCache", () => {
  it.effect("serves cached provider API values until the TTL expires", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const cache = yield* makeProviderApiCache<number>({
        provider: "provider-cache-ttl",
        instanceId: "default",
        kind: "modelList",
        ttl: Duration.millis(100),
        capacity: 4,
      });
      const lookup = Ref.updateAndGet(calls, (count) => count + 1);

      const first = yield* cache.get({ key: "models", lookup });
      const second = yield* cache.get({ key: "models", lookup });

      assert.equal(first, 1);
      assert.equal(second, 1);
      assert.equal(yield* Ref.get(calls), 1);

      yield* TestClock.adjust(Duration.millis(101));

      const third = yield* cache.get({ key: "models", lookup });

      assert.equal(third, 2);
      assert.equal(yield* Ref.get(calls), 2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("deduplicates concurrent provider API misses for the same key", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const releaseLookup = yield* Deferred.make<void>();
      const cache = yield* makeProviderApiCache<string>({
        provider: "provider-cache-concurrent",
        instanceId: "default",
        kind: "modelList",
        ttl: Duration.minutes(5),
        capacity: 4,
      });
      const lookup = Ref.update(calls, (count) => count + 1).pipe(
        Effect.flatMap(() => Deferred.await(releaseLookup)),
        Effect.as("ready"),
      );

      const resultsFiber = yield* Effect.all(
        [
          cache.get({ key: "models", lookup }),
          cache.get({ key: "models", lookup }),
          cache.get({ key: "models", lookup }),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.equal(yield* Ref.get(calls), 1);
      yield* Deferred.succeed(releaseLookup, undefined);

      assert.deepStrictEqual(yield* Fiber.join(resultsFiber), ["ready", "ready", "ready"]);
    }),
  );

  it.effect("invalidates cached values and emits cache metrics", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const cache = yield* makeProviderApiCache<number>({
        provider: "provider-cache-invalidates",
        instanceId: "default",
        kind: "capabilities",
        ttl: Duration.minutes(15),
        capacity: 4,
      });
      const lookup = Ref.updateAndGet(calls, (count) => count + 1);

      assert.equal(yield* cache.get({ key: "capabilities", lookup }), 1);
      assert.equal(yield* cache.get({ key: "capabilities", lookup }), 1);

      yield* cache.invalidate("capabilities");

      assert.equal(yield* cache.get({ key: "capabilities", lookup }), 2);
      assert.equal(yield* Ref.get(calls), 2);

      const snapshots = yield* Metric.snapshot;
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_api_cache_requests_total", {
          provider: "provider-cache-invalidates",
          instanceId: "default",
          kind: "capabilities",
          result: "miss",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_api_cache_requests_total", {
          provider: "provider-cache-invalidates",
          instanceId: "default",
          kind: "capabilities",
          result: "hit",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_api_cache_invalidations_total", {
          provider: "provider-cache-invalidates",
          instanceId: "default",
          kind: "capabilities",
        }),
        true,
      );
    }),
  );
});
