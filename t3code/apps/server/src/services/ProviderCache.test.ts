import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import {
  ProviderRegistry,
  type ProviderRegistryShape,
} from "../provider/Services/ProviderRegistry.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../provider/Services/ProviderService.ts";
import {
  makeProviderCache,
  ProviderCache,
  ProviderCacheLive,
  type ProviderCacheConfig,
  type ProviderCacheLookups,
} from "./ProviderCache.ts";

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

const INSTANCE = ProviderInstanceId.make("codex");
const OTHER_INSTANCE = ProviderInstanceId.make("claude");

const MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "gpt-x", name: "GPT-X", isCustom: false, capabilities: null },
];

const CAPABILITIES: ProviderAdapterCapabilities = { sessionModelSwitch: "in-session" };

const config: ProviderCacheConfig = {
  modelListTtl: Duration.minutes(5),
  capabilityTtl: Duration.minutes(15),
  capacity: 8,
};

const countingLookups = (
  modelCalls: Ref.Ref<number>,
  capabilityCalls: Ref.Ref<number>,
): ProviderCacheLookups => ({
  fetchModels: () => Ref.update(modelCalls, (count) => count + 1).pipe(Effect.as(MODELS)),
  fetchCapabilities: () =>
    Ref.update(capabilityCalls, (count) => count + 1).pipe(Effect.as(CAPABILITIES)),
});

describe("ProviderCache", () => {
  it.effect("serves repeated model reads from cache within the TTL after one lookup", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const cache = yield* makeProviderCache({
        config,
        lookups: countingLookups(modelCalls, capabilityCalls),
      });

      const first = yield* cache.getModels(INSTANCE);
      const second = yield* cache.getModels(INSTANCE);

      assert.deepStrictEqual(first, MODELS);
      assert.deepStrictEqual(second, MODELS);
      assert.equal(yield* Ref.get(modelCalls), 1);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("re-fetches a model list after its TTL elapses while capabilities stay cached", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const cache = yield* makeProviderCache({
        config,
        lookups: countingLookups(modelCalls, capabilityCalls),
      });

      yield* cache.getModels(INSTANCE);
      yield* cache.getCapabilities(INSTANCE);

      // Still inside both TTLs: both reads are served from cache.
      yield* TestClock.adjust(Duration.minutes(1));
      yield* cache.getModels(INSTANCE);
      yield* cache.getCapabilities(INSTANCE);
      assert.equal(yield* Ref.get(modelCalls), 1);
      assert.equal(yield* Ref.get(capabilityCalls), 1);

      // Past the 5m model TTL but within the 15m capability TTL.
      yield* TestClock.adjust(Duration.minutes(5));
      yield* cache.getModels(INSTANCE);
      yield* cache.getCapabilities(INSTANCE);
      assert.equal(yield* Ref.get(modelCalls), 2);
      assert.equal(yield* Ref.get(capabilityCalls), 1);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("invalidateProvider drops cached entries so the next read hits the provider", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const cache = yield* makeProviderCache({
        config,
        lookups: countingLookups(modelCalls, capabilityCalls),
      });

      yield* cache.getModels(INSTANCE);
      yield* cache.getCapabilities(INSTANCE);
      assert.equal(yield* Ref.get(modelCalls), 1);
      assert.equal(yield* Ref.get(capabilityCalls), 1);

      yield* cache.invalidateProvider(INSTANCE);

      yield* cache.getModels(INSTANCE);
      yield* cache.getCapabilities(INSTANCE);
      assert.equal(yield* Ref.get(modelCalls), 2);
      assert.equal(yield* Ref.get(capabilityCalls), 2);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("invalidateAll clears every provider's entries", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const cache = yield* makeProviderCache({
        config,
        lookups: countingLookups(modelCalls, capabilityCalls),
      });

      yield* cache.getModels(INSTANCE);
      yield* cache.getModels(OTHER_INSTANCE);
      assert.equal(yield* Ref.get(modelCalls), 2);

      yield* cache.invalidateAll;

      yield* cache.getModels(INSTANCE);
      yield* cache.getModels(OTHER_INSTANCE);
      assert.equal(yield* Ref.get(modelCalls), 4);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("concurrent reads of an uncached key trigger only one provider lookup", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const latch = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const cache = yield* makeProviderCache({
        config,
        lookups: {
          fetchModels: () =>
            Effect.gen(function* () {
              yield* Ref.update(modelCalls, (count) => count + 1);
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(latch);
              return MODELS;
            }),
          fetchCapabilities: () => Effect.succeed(CAPABILITIES),
        },
      });

      const fiber = yield* Effect.fork(
        Effect.all(
          Array.from({ length: 5 }, () => cache.getModels(INSTANCE)),
          { concurrency: "unbounded" },
        ),
      );

      // Wait until the single in-flight lookup has started, give the other
      // callers a chance to attach to it, then release the lookup.
      yield* Deferred.await(started);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Deferred.succeed(latch, undefined);

      const results = yield* Fiber.join(fiber);
      assert.equal(results.length, 5);
      results.forEach((result) => assert.deepStrictEqual(result, MODELS));
      assert.equal(yield* Ref.get(modelCalls), 1);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("tracks hit/miss stats and emits cache metrics", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const cache = yield* makeProviderCache({
        config,
        lookups: countingLookups(modelCalls, capabilityCalls),
      });

      yield* cache.getModels(INSTANCE); // miss
      yield* cache.getModels(INSTANCE); // hit

      const stats = yield* cache.stats;
      assert.equal(stats.misses, 1);
      assert.equal(stats.hits, 1);

      const snapshots = yield* Metric.snapshot;
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_cache_misses_total", { cache: "models" }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_cache_hits_total", { cache: "models" }),
        true,
      );
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("bounds retained entries by the configured capacity", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const cache = yield* makeProviderCache({
        config: { ...config, capacity: 1 },
        lookups: countingLookups(modelCalls, capabilityCalls),
      });

      yield* cache.getModels(INSTANCE); // stores INSTANCE
      yield* cache.getModels(OTHER_INSTANCE); // evicts INSTANCE (capacity 1)
      yield* cache.getModels(INSTANCE); // INSTANCE evicted -> fresh lookup

      assert.equal(yield* Ref.get(modelCalls), 3);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect("rejects a non-positive cache capacity with a typed error", () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const capabilityCalls = yield* Ref.make(0);
      const error = yield* Effect.flip(
        makeProviderCache({
          config: { ...config, capacity: 0 },
          lookups: countingLookups(modelCalls, capabilityCalls),
        }),
      );

      assert.equal(error._tag, "ProviderCacheError");
      assert.ok(error.detail.includes("capacity"));
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});

// Provider snapshot fixtures for exercising the wired-up `ProviderCacheLive`
// against fake `ProviderRegistry` / `ProviderService` implementations.
const serverProvider = (
  instanceId: ProviderInstanceId,
  driver: string,
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models,
  slashCommands: [],
  skills: [],
});

const PROVIDER_A = serverProvider(INSTANCE, "codex", MODELS);
const PROVIDER_B = serverProvider(OTHER_INSTANCE, "claudeAgent", MODELS);
const INITIAL_PROVIDERS: ReadonlyArray<ServerProvider> = [PROVIDER_A, PROVIDER_B];

const fakeRegistry = (
  providersRef: Ref.Ref<ReadonlyArray<ServerProvider>>,
  getProvidersCalls: Ref.Ref<number>,
  changes: Queue.Queue<ReadonlyArray<ServerProvider>>,
): ProviderRegistryShape => ({
  getProviders: Ref.update(getProvidersCalls, (count) => count + 1).pipe(
    Effect.zipRight(Ref.get(providersRef)),
  ),
  refresh: () => Ref.get(providersRef),
  refreshInstance: () => Ref.get(providersRef),
  getProviderMaintenanceCapabilitiesForInstance: () =>
    Effect.die("getProviderMaintenanceCapabilitiesForInstance is unused in this test"),
  setProviderMaintenanceActionState: () => Ref.get(providersRef),
  streamChanges: Stream.fromQueue(changes),
});

const fakeService = (capabilityCalls: Ref.Ref<number>): ProviderServiceShape =>
  ({
    getCapabilities: () =>
      Ref.update(capabilityCalls, (count) => count + 1).pipe(Effect.as(CAPABILITIES)),
  }) as unknown as ProviderServiceShape;

// Yield enough times for the forked `streamChanges` reconciliation fiber to
// drain a freshly offered emission before we assert on its effect.
const settleStreamChanges = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

describe("ProviderCacheLive", () => {
  it.effect(
    "serves a real consumer through the wired Live layer, hitting the provider service once",
    () =>
      Effect.gen(function* () {
        const getProvidersCalls = yield* Ref.make(0);
        const capabilityCalls = yield* Ref.make(0);
        const providersRef = yield* Ref.make(INITIAL_PROVIDERS);
        const changes = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();
        const registry = fakeRegistry(providersRef, getProvidersCalls, changes);
        const cacheLayer = ProviderCacheLive.pipe(
          Layer.provide(Layer.succeed(ProviderRegistry, registry)),
          Layer.provide(Layer.succeed(ProviderService, fakeService(capabilityCalls))),
        );

        yield* Effect.gen(function* () {
          const cache = yield* ProviderCache;

          // Two capability reads of the same instance: the underlying provider
          // service is consulted exactly once; the second is served from cache.
          const first = yield* cache.getCapabilities(INSTANCE);
          const second = yield* cache.getCapabilities(INSTANCE);
          assert.deepStrictEqual(first, CAPABILITIES);
          assert.deepStrictEqual(second, CAPABILITIES);
          assert.equal(yield* Ref.get(capabilityCalls), 1);

          // Model reads resolve through the registry snapshot and are cached too.
          const models = yield* cache.getModels(INSTANCE);
          yield* cache.getModels(INSTANCE);
          assert.deepStrictEqual(models, MODELS);
        }).pipe(Effect.provide(cacheLayer));
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.effect(
    "invalidates only the instance whose registry snapshot changed, leaving others cached",
    () =>
      Effect.gen(function* () {
        const getProvidersCalls = yield* Ref.make(0);
        const capabilityCalls = yield* Ref.make(0);
        const providersRef = yield* Ref.make(INITIAL_PROVIDERS);
        const changes = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();
        const registry = fakeRegistry(providersRef, getProvidersCalls, changes);
        const cacheLayer = ProviderCacheLive.pipe(
          Layer.provide(Layer.succeed(ProviderRegistry, registry)),
          Layer.provide(Layer.succeed(ProviderService, fakeService(capabilityCalls))),
        );

        yield* Effect.gen(function* () {
          const cache = yield* ProviderCache;

          // Prime both instances, then re-read so both are cache hits.
          yield* cache.getModels(INSTANCE);
          yield* cache.getModels(OTHER_INSTANCE);
          yield* cache.getModels(INSTANCE);
          yield* cache.getModels(OTHER_INSTANCE);
          const callsBeforeChange = yield* Ref.get(getProvidersCalls);

          // A blanket snapshot emission in which only INSTANCE actually changed.
          const changedA = serverProvider(INSTANCE, "codex", []);
          yield* Ref.set(providersRef, [changedA, PROVIDER_B]);
          yield* Queue.offer(changes, [changedA, PROVIDER_B]);
          yield* settleStreamChanges;

          // INSTANCE was invalidated -> one fresh registry read; OTHER_INSTANCE
          // is untouched -> still served from cache (no extra registry read).
          const refreshed = yield* cache.getModels(INSTANCE);
          yield* cache.getModels(OTHER_INSTANCE);
          const callsAfterChange = yield* Ref.get(getProvidersCalls);

          assert.deepStrictEqual(refreshed, []);
          assert.equal(callsAfterChange - callsBeforeChange, 1);
        }).pipe(Effect.provide(cacheLayer));
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});
