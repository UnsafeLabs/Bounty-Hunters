import { it, assert, expect } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";

import {
  makeProviderCache,
  type ProviderCacheInvalidationEvent,
  type ProviderCacheResolvers,
} from "./ProviderCache.ts";

const TEST_INSTANCE = "codex_test";
const TEST_INSTANCE_2 = "claudeAgent_test";

const makeTestModels = (tag: string): ReadonlyArray<unknown> => [
  { slug: `${tag}-model-1`, name: `${tag} Model 1`, isCustom: false },
];

const makeTestCapability = (tag: string): unknown => ({
  sessionModelSwitch: "in-session" as const,
  tag,
});

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
          Effect.map((count) => makeTestModels(`${instanceId}-${count}`)),
        ),
      resolveCapabilities: (instanceId) =>
        Ref.updateAndGet(capabilitiesCalls, (n) => n + 1).pipe(
          Effect.map((count) => makeTestCapability(`${instanceId}-${count}`)),
        ),
    };

    return {
      resolvers,
      modelsCallCount: Ref.get(modelsCalls),
      capabilitiesCallCount: Ref.get(capabilitiesCalls),
    };
  });

it.effect("caches models after first access", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("dedup");
    const cache = yield* makeProviderCache(test.resolvers);

    const r1 = yield* cache.getModels(TEST_INSTANCE);
    const r2 = yield* cache.getModels(TEST_INSTANCE);
    const count = yield* test.modelsCallCount;

    expect(r1).toEqual(makeTestModels("codex_test-1"));
    expect(r2).toEqual(makeTestModels("codex_test-1"));
    assert.strictEqual(count, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("caches capabilities after first access", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("cap");
    const cache = yield* makeProviderCache(test.resolvers);

    const r1 = yield* cache.getCapabilities(TEST_INSTANCE);
    const r2 = yield* cache.getCapabilities(TEST_INSTANCE);
    const count = yield* test.capabilitiesCallCount;

    expect(r1).toEqual(makeTestCapability("codex_test-1"));
    expect(r2).toEqual(makeTestCapability("codex_test-1"));
    assert.strictEqual(count, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("separates cache entries per instance id", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("per-instance");
    const cache = yield* makeProviderCache(test.resolvers);

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    assert.strictEqual(yield* test.modelsCallCount, 2);

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    assert.strictEqual(yield* test.modelsCallCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("invalidates specific entry on invalidation event", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("invalidate");
    const cache = yield* makeProviderCache(test.resolvers);

    yield* cache.getModels(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 1);

    yield* cache.invalidate({ cacheType: "models", instanceId: TEST_INSTANCE });
    yield* cache.getModels(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 2);

    yield* cache.getModels(TEST_INSTANCE_2);
    assert.strictEqual(yield* test.modelsCallCount, 3);

    yield* cache.getModels(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 3);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("invalidates all entries of a cache type", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("invalidate-all");
    const cache = yield* makeProviderCache(test.resolvers);

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    yield* cache.getCapabilities(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 2);
    assert.strictEqual(yield* test.capabilitiesCallCount, 1);

    yield* cache.invalidate({ cacheType: "models" });
    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getModels(TEST_INSTANCE_2);
    yield* cache.getCapabilities(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 4);
    assert.strictEqual(yield* test.capabilitiesCallCount, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("invalidates entire cache when event has no type or instanceId", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("invalidate-all-all");
    const cache = yield* makeProviderCache(test.resolvers);

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getCapabilities(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 1);
    assert.strictEqual(yield* test.capabilitiesCallCount, 1);

    yield* cache.invalidate({});

    yield* cache.getModels(TEST_INSTANCE);
    yield* cache.getCapabilities(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 2);
    assert.strictEqual(yield* test.capabilitiesCallCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("respects models TTL — re-fetches after expiry", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("ttl");
    const cache = yield* makeProviderCache(test.resolvers);

    yield* cache.getModels(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 1);

    yield* TestClock.adjust(Duration.minutes(6));
    yield* cache.getModels(TEST_INSTANCE);
    assert.strictEqual(yield* test.modelsCallCount, 2);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("deduplicates concurrent requests for same key", () =>
  Effect.gen(function* () {
    const latch = yield* Deferred.make<void>();
    const test = yield* makeTestResolvers("dedup-concurrent");

    const blockedResolvers: ProviderCacheResolvers = {
      ...test.resolvers,
      resolveModels: (_id) =>
        Deferred.await(latch).pipe(Effect.andThen(test.resolvers.resolveModels(_id))),
    };

    const cache = yield* makeProviderCache(blockedResolvers);

    const f1 = yield* cache.getModels(TEST_INSTANCE).pipe(Effect.forkScoped);
    const f2 = yield* cache.getModels(TEST_INSTANCE).pipe(Effect.forkScoped);

    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    yield* Deferred.succeed(latch, void 0);

    const [r1, r2] = yield* Effect.all([Fiber.join(f1), Fiber.join(f2)]);
    expect(r1).toEqual(r2);
    assert.strictEqual(yield* test.modelsCallCount, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("provides invalidation hub for external subscribers", () =>
  Effect.gen(function* () {
    const test = yield* makeTestResolvers("hub");
    const cache = yield* makeProviderCache(test.resolvers);

    const sub = yield* PubSub.subscribe(cache.invalidationHub);
    const received = yield* Ref.make<Array<ProviderCacheInvalidationEvent>>([]);

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          const event = yield* PubSub.take(sub);
          yield* Ref.update(received, (evts) => [...evts, event]);
        }
      }),
    );

    yield* cache.invalidate({ cacheType: "models", instanceId: TEST_INSTANCE });
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;

    const events = yield* Ref.get(received);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].cacheType, "models");
    assert.strictEqual(events[0].instanceId, TEST_INSTANCE);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

