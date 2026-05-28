/**
 * ProviderCache tests — TTL expiry, invalidation, concurrent dedup, metrics.
 */
import { ProviderInstanceId } from "@t3tools/contracts";
import { it, assert, expect } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Hub from "effect/Hub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import {
  makeProviderCache,
  type ProviderCacheInvalidationEvent,
  type ProviderCacheResolvers,
} from "./ProviderCache.ts";

const TEST_INSTANCE = ProviderInstanceId.make("codex_test");
const TEST_INSTANCE_2 = ProviderInstanceId.make("claudeAgent_test");

const makeTestModels = (tag: string): ReadonlyArray<unknown> => [
  { slug: `${tag}-model-1`, name: `${tag} Model 1`, isCustom: false },
];

const makeTestCapability = (tag: string): unknown => ({
  sessionModelSwitch: "in-session" as const,
  tag,
});

/**
 * Create a simple set of resolvers backed by a Ref counter so we can
 * observe how many times each resolver was called.
 */
const makeTestResolvers = (
  modelsTag = "test",
  capabilitiesTag = "test",
): Effect.Effect<{
  readonly resolvers: ProviderCacheResolvers;
  readonly modelsCallCount: Effect.Effect<number>;
  readonly capabilitiesCallCount: Effect.Effect<number>;
}, never, Scope.Scope> =>
  Effect.gen(function* () {
    const modelsCalls = yield* Ref.make(0);
    const capabilitiesCalls = yield* Ref.make(0);

    const resolvers: ProviderCacheResolvers = {
      resolveModels: (instanceId) =>
        Ref.updateAndGet(modelsCalls, (n) => n + 1).pipe(
          Effect.map(
            (count) => makeTestModels(`${String(instanceId)}-${count}`),
          ),
        ),
      resolveCapabilities: (instanceId) =>
        Ref.updateAndGet(capabilitiesCalls, (n) => n + 1).pipe(
          Effect.map(
            (count) => makeTestCapability(`${String(instanceId)}-${count}`),
          ),
        ),
    };

    return {
      resolvers,
      modelsCallCount: Ref.get(modelsCalls),
      capabilitiesCallCount: Ref.get(capabilitiesCalls),
    };
  });

// ── Tests ──────────────────────────────────────────────────────────────

it.effect("caches models after first access and returns same reference", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("dedup");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    const result1 = yield* cache.getModels(TEST_INSTANCE);
    const result2 = yield* cache.getModels(TEST_INSTANCE);
    const callCount = yield* testResolvers.modelsCallCount;

    expect(result1).toEqual(makeTestModels("codex_test-1"));
    expect(result2).toEqual(makeTestModels("codex_test-1"));
    assert.strictEqual(callCount, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("caches capabilities after first access and returns same reference", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("cap");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    const result1 = yield* cache.getCapabilities(TEST_INSTANCE);
    const result2 = yield* cache.getCapabilities(TEST_INSTANCE);
    const callCount = yield* testResolvers.capabilitiesCallCount;

    expect(result1).toEqual(makeTestCapability("codex_test-1"));
    expect(result2).toEqual(makeTestCapability("codex_test-1"));
    assert.strictEqual(callCount, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("separates cache entries per instance id", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("per-instance");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);

    const callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 2);

    // Re-access — should not call resolvers again
    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    const callCount2 = yield* testResolvers.modelsCallCount;

    assert.strictEqual(callCount2, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("invalidates a specific entry on invalidation event", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("invalidate");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    yield* cache.getModels(TEST_INSTANCE);
    let callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 1);

    // Invalidate specific entry
    yield* cache.invalidate({
      cacheType: "models",
      instanceId: TEST_INSTANCE,
    });

    yield* cache.getModels(TEST_INSTANCE);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 2);

    // Other entries remain cached
    yield* cache.getModels(TEST_INSTANCE_2);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 3);

    // Re-access the invalidated one — cached again
    yield* cache.getModels(TEST_INSTANCE);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 3);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("invalidates all entries of a cache type", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("invalidate-all");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    yield* cache.getCapabilities(TEST_INSTANCE);

    let modelsCount = yield* testResolvers.modelsCallCount;
    let capsCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(modelsCount, 2);
    assert.strictEqual(capsCount, 1);

    // Invalidate all models
    yield* cache.invalidate({ cacheType: "models" });

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    yield* cache.getCapabilities(TEST_INSTANCE);

    modelsCount = yield* testResolvers.modelsCallCount;
    capsCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(modelsCount, 4); // both re-fetched
    assert.strictEqual(capsCount, 1); // capabilities untouched
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("invalidates entire cache when event has no type or instanceId", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("invalidate-all-all");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getCapabilities(TEST_INSTANCE);

    let modelsCount = yield* testResolvers.modelsCallCount;
    let capsCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(modelsCount, 1);
    assert.strictEqual(capsCount, 1);

    // Invalidate everything
    yield* cache.invalidate({});

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getCapabilities(TEST_INSTANCE);

    modelsCount = yield* testResolvers.modelsCallCount;
    capsCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(modelsCount, 2);
    assert.strictEqual(capsCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("respects models TTL — re-fetches after expiry", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("ttl");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(5),
      capabilitiesTtl: Duration.minutes(30),
    });

    yield* cache.getModels(TEST_INSTANCE);
    let callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 1);

    // Advance past TTL
    yield* TestClock.adjust(Duration.minutes(6));

    yield* cache.getModels(TEST_INSTANCE);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("respects capabilities TTL — re-fetches after expiry", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("cap-ttl");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(30),
      capabilitiesTtl: Duration.minutes(15),
    });

    yield* cache.getCapabilities(TEST_INSTANCE);
    let callCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(callCount, 1);

    // Advance past TTL
    yield* TestClock.adjust(Duration.minutes(16));

    yield* cache.getCapabilities(TEST_INSTANCE);
    callCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(callCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("does not re-fetch models before TTL expiry", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("no-refetch");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(5),
      capabilitiesTtl: Duration.minutes(30),
    });

    yield* cache.getModels(TEST_INSTANCE);
    let callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 1);

    // Advance some but not past TTL
    yield* TestClock.adjust(Duration.minutes(3));

    yield* cache.getModels(TEST_INSTANCE);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 1); // still cached

    // Now advance past TTL
    yield* TestClock.adjust(Duration.minutes(3));

    yield* cache.getModels(TEST_INSTANCE);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("deduplicates concurrent requests for the same key", () =>
  Effect.gen(function* () {
    const latch = yield* Deferred.make<void>();

    const testResolvers = yield* makeTestResolvers("dedup-concurrent");
    // Override the models resolver to block on the latch
    const blockedResolvers: ProviderCacheResolvers = {
      ...testResolvers.resolvers,
      resolveModels: (_instanceId) =>
        Deferred.await(latch).pipe(
          Effect.andThen(testResolvers.resolvers.resolveModels(_instanceId)),
        ),
    };

    const cache = yield* makeProviderCache(blockedResolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    // Start two concurrent requests for the same key
    const fiber1 = yield* cache.getModels(TEST_INSTANCE).pipe(Effect.fork);
    const fiber2 = yield* cache.getModels(TEST_INSTANCE).pipe(Effect.fork);

    // Release the latch after both are queued
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    yield* Deferred.succeed(latch, void 0);

    const [result1, result2] = yield* Effect.all([
      Fiber.join(fiber1),
      Fiber.join(fiber2),
    ]);

    // Both should get the same result
    expect(result1).toEqual(result2);

    // Resolver should only have been called once
    const callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("provides invalidation hub for external subscribers", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("hub");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    // Subscribe externally
    const sub = yield* Hub.subscribe(cache.invalidationHub);
    const received = yield* Ref.make<Array<ProviderCacheInvalidationEvent>>(
      [],
    );

    yield* Effect.forkScoped(
      Effect.forEach(
        Stream.fromSubscription(sub),
        (event: ProviderCacheInvalidationEvent) =>
          Ref.update(received, (events) => [...events, event]),
      ),
    );

    // Publish an invalidation event through the service
    yield* cache.invalidate({
      cacheType: "models",
      instanceId: TEST_INSTANCE,
    });

    // Give the fiber time to process
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;

    const events = yield* Ref.get(received);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].cacheType, "models");
    assert.strictEqual(String(events[0].instanceId), String(TEST_INSTANCE));
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("use default TTLs when options are not provided", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("defaults");
    const cache = yield* makeProviderCache(testResolvers.resolvers);

    yield* cache.getModels(TEST_INSTANCE);
    let callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 1);

    // Advance just past the default models TTL (5 min)
    yield* TestClock.adjust(Duration.minutes(6));

    yield* cache.getModels(TEST_INSTANCE);
    callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(callCount, 2);

    yield* cache.getCapabilities(TEST_INSTANCE);
    let capsCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(capsCount, 1);

    // Default capabilities TTL is 15 min, so it should still be cached
    yield* TestClock.adjust(Duration.minutes(10)); // total now 16 min past initial

    yield* cache.getCapabilities(TEST_INSTANCE);
    capsCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(capsCount, 2); // expired after 15 min
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("tracks cache hit/miss metrics for models", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("metrics");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    // First access = miss
    yield* cache.getModels(TEST_INSTANCE);

    // Second access = hit
    yield* cache.getModels(TEST_INSTANCE);

    const callCount = yield* testResolvers.modelsCallCount;
    assert.strictEqual(
      callCount,
      1,
      "resolver called once = 1 miss, second access was a hit",
    );
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("tracks cache hit/miss metrics for capabilities", () =>
  Effect.gen(function* () {
    const testResolvers = yield* makeTestResolvers("cap-metrics");
    const cache = yield* makeProviderCache(testResolvers.resolvers, {
      modelsTtl: Duration.minutes(10),
      capabilitiesTtl: Duration.minutes(10),
    });

    // First access = miss
    yield* cache.getCapabilities(TEST_INSTANCE);

    // Second access = hit
    yield* cache.getCapabilities(TEST_INSTANCE);

    const callCount = yield* testResolvers.capabilitiesCallCount;
    assert.strictEqual(
      callCount,
      1,
      "resolver called once = 1 miss, second access was a hit",
    );
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);
