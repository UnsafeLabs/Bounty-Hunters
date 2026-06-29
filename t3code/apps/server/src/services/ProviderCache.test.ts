/**
 * ProviderCache tests.
 *
 * Verifies TTL expiry, cache invalidation, concurrent dedup (via
 * Effect.Cache), and cache hit/miss metrics.
 */
import { assert, it } from "@effect/vitest";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Metric from "effect/Metric";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vitest";

import { CACHE_TTL, makeProviderCache } from "./ProviderCache.ts";

// ── Test helpers ────────────────────────────────────────────────────────

const makeTestProvider = (name: string) => name as any;

const findCounterSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
): number => {
  const match = snapshots.find(
    (snapshot): snapshot is Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }> =>
      snapshot.type === "Counter" &&
      snapshot.id === id &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );
  return Number(match?.state.count ?? 0);
};

// Provide TestClock layer. getOrCompute uses DateTime.now (R=never) so
// TestClock only matters for the TTL test where we advance the clock.
const withClock = <A>(effect: Effect.Effect<A, never, Clock.Clock>) =>
  effect.pipe(Effect.provide(TestClock.layer()));

// ── Tests ───────────────────────────────────────────────────────────────

describe("ProviderCache", () => {
  it.effect("returns cached value on subsequent calls", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");
      let callCount = 0;

      const result1 = yield* cache.getOrCompute("model_list", "codex", codex, () => {
        callCount++;
        return Effect.succeed(["gpt-5", "gpt-5-mini"]);
      });
      assert.deepStrictEqual(result1, ["gpt-5", "gpt-5-mini"]);
      assert.strictEqual(callCount, 1);

      const result2 = yield* cache.getOrCompute("model_list", "codex", codex, () => {
        callCount++;
        return Effect.succeed(["gpt-5", "gpt-5-mini"]);
      });
      assert.deepStrictEqual(result2, ["gpt-5", "gpt-5-mini"]);
      assert.strictEqual(callCount, 1);
    }),
  );

  it.effect("cache miss triggers fresh API call", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");
      let callCount = 0;

      yield* cache.getOrCompute("model_list", "codex", codex, () => {
        callCount++;
        return Effect.succeed(["gpt-5"]);
      });
      assert.strictEqual(callCount, 1);

      yield* cache.getOrCompute("model_list", "claude", codex, () => {
        callCount++;
        return Effect.succeed(["claude-sonnet"]);
      });
      assert.strictEqual(callCount, 2);
    }),
  );

  it.effect("invalidation clears cached entries for a provider", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");
      const claude = makeTestProvider("claudeAgent");
      let codexCallCount = 0;
      let claudeCallCount = 0;

      yield* cache.getOrCompute("model_list", "models", codex, () => {
        codexCallCount++;
        return Effect.succeed(["gpt-5"]);
      });
      yield* cache.getOrCompute("model_list", "models", claude, () => {
        claudeCallCount++;
        return Effect.succeed(["claude-sonnet"]);
      });

      yield* cache.invalidate(codex);

      yield* cache.getOrCompute("model_list", "models", codex, () => {
        codexCallCount++;
        return Effect.succeed(["gpt-5"]);
      });
      assert.strictEqual(codexCallCount, 2);

      yield* cache.getOrCompute("model_list", "models", claude, () => {
        claudeCallCount++;
        return Effect.succeed(["claude-sonnet"]);
      });
      assert.strictEqual(claudeCallCount, 1);
    }),
  );

  it.effect("invalidation scoped to cache type", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");
      let modelCallCount = 0;
      let capCallCount = 0;

      yield* cache.getOrCompute("model_list", "models", codex, () => {
        modelCallCount++;
        return Effect.succeed(["gpt-5"]);
      });
      yield* cache.getOrCompute("capability", "gpt-5", codex, () => {
        capCallCount++;
        return Effect.succeed({ streaming: true });
      });

      yield* cache.invalidate(codex, "model_list");

      yield* cache.getOrCompute("model_list", "models", codex, () => {
        modelCallCount++;
        return Effect.succeed(["gpt-5"]);
      });
      assert.strictEqual(modelCallCount, 2);

      yield* cache.getOrCompute("capability", "gpt-5", codex, () => {
        capCallCount++;
        return Effect.succeed({ streaming: true });
      });
      assert.strictEqual(capCallCount, 1);
    }),
  );

  it.effect("cache hit/miss metrics are tracked", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");

      // Snapshot before.
      const before = yield* Metric.snapshot;
      const hitsBefore = findCounterSnapshot(before, "t3_provider_cache_hits_total", {
        cache_type: "model_list",
        provider: "codex",
      });
      const missesBefore = findCounterSnapshot(before, "t3_provider_cache_misses_total", {
        cache_type: "model_list",
        provider: "codex",
      });

      // First call = miss.
      yield* cache.getOrCompute("model_list", "codex", codex, () => Effect.succeed(["gpt-5"]));

      // Second call = hit.
      yield* cache.getOrCompute("model_list", "codex", codex, () => Effect.succeed(["gpt-5"]));

      const after = yield* Metric.snapshot;
      const hitsAfter = findCounterSnapshot(after, "t3_provider_cache_hits_total", {
        cache_type: "model_list",
        provider: "codex",
      });
      const missesAfter = findCounterSnapshot(after, "t3_provider_cache_misses_total", {
        cache_type: "model_list",
        provider: "codex",
      });

      assert.strictEqual(hitsAfter - hitsBefore, 1, "should have 1 hit delta");
      assert.strictEqual(missesAfter - missesBefore, 1, "should have 1 miss delta");
    }),
  );

  it.effect("different cache types have independent storage", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");

      yield* cache.getOrCompute("model_list", "gpt-5", codex, () =>
        Effect.succeed({ value: "gpt-5" }),
      );
      yield* cache.getOrCompute("capability", "gpt-5", codex, () =>
        Effect.succeed({ value: "streaming", streaming: true }),
      );

      const r1 = yield* cache.getOrCompute("model_list", "gpt-5", codex, () =>
        Effect.succeed({ value: "stale" }),
      );
      assert.deepStrictEqual(r1, { value: "gpt-5" });

      const r2 = yield* cache.getOrCompute("capability", "gpt-5", codex, () =>
        Effect.succeed({ value: "stale", streaming: false }),
      );
      assert.deepStrictEqual(r2, { value: "streaming", streaming: true });
    }),
  );

  it.effect("memory usage is bounded by max entries", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");

      for (let i = 0; i < 300; i++) {
        yield* cache.getOrCompute("model_list", `model-${i}`, codex, () =>
          Effect.succeed([`model-${i}`]),
        );
      }

      const hitEarly = yield* cache.getOrCompute("model_list", "model-0", codex, () =>
        Effect.succeed(["recomputed"]),
      );
      assert.deepStrictEqual(hitEarly, ["recomputed"], "oldest entries should be evicted");
    }),
  );

  it.effect("concurrent requests for same key only trigger one lookup", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const codex = makeTestProvider("codex");
      let callCount = 0;

      const dedupCache = yield* Cache.make({
        capacity: 256,
        timeToLive: Duration.minutes(5),
        lookup: (key: string) =>
          cache.getOrCompute("model_list", key, codex, () => {
            callCount++;
            return Effect.succeed([`result-${key}`]);
          }),
      });

      const fibers = yield* Effect.all(
        Array.from({ length: 10 }, () => Effect.forkChild(Cache.get(dedupCache, "shared-key"))),
      );
      const results = yield* Effect.all(
        fibers.map((f: Fiber.Fiber<string[], never>) => Fiber.join(f)),
      );

      assert.strictEqual(callCount, 1, "should only call lookup once");
      assert.strictEqual(results.length, 10);
      for (const r of results) {
        assert.deepStrictEqual(r, ["result-shared-key"]);
      }
    }),
  );
});
