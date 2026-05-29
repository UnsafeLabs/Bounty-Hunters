import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";
import { ProviderCache } from "../Services/ProviderCache.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import { makeProviderCacheTestLayer } from "./ProviderCache.ts";

const codexInstanceId = ProviderInstanceId.make("codex");
const codexDriver = ProviderDriverKind.make("codex");
const modelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoning",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
  ],
});

const makeProvider = (modelSlug: string): ServerProvider => ({
  instanceId: codexInstanceId,
  driver: codexDriver,
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [
    {
      slug: modelSlug,
      name: modelSlug,
      isCustom: false,
      capabilities: modelCapabilities,
    },
  ],
  slashCommands: [],
  skills: [],
});

const makeProviderRegistryLayer = (input: {
  readonly providersRef: Ref.Ref<ReadonlyArray<ServerProvider>>;
  readonly refreshCountRef: Ref.Ref<number>;
  readonly refreshGate?: Deferred.Deferred<void>;
}) =>
  Layer.succeed(ProviderRegistry, {
    getProviders: Ref.get(input.providersRef),
    refresh: () =>
      Ref.update(input.refreshCountRef, (count) => count + 1).pipe(
        Effect.andThen(input.refreshGate ? Deferred.await(input.refreshGate) : Effect.void),
        Effect.andThen(Ref.get(input.providersRef)),
      ),
    refreshInstance: () =>
      Ref.update(input.refreshCountRef, (count) => count + 1).pipe(
        Effect.andThen(input.refreshGate ? Deferred.await(input.refreshGate) : Effect.void),
        Effect.andThen(Ref.get(input.providersRef)),
      ),
    getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
      Effect.succeed(
        makeManualOnlyProviderMaintenanceCapabilities({
          provider,
          packageName: null,
        }),
      ),
    setProviderMaintenanceActionState: () => Ref.get(input.providersRef),
    streamChanges: Stream.empty,
  } satisfies ProviderRegistryShape);

const makeServerSettingsLayer = (streamChanges: Stream.Stream<ServerSettings> = Stream.empty) =>
  Layer.succeed(ServerSettingsService, {
    start: Effect.void,
    ready: Effect.void,
    getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
    streamChanges,
  } satisfies ServerSettingsShape);

const makeTestLayer = (
  input: {
    readonly providersRef: Ref.Ref<ReadonlyArray<ServerProvider>>;
    readonly refreshCountRef: Ref.Ref<number>;
    readonly refreshGate?: Deferred.Deferred<void>;
    readonly settingsChanges?: Stream.Stream<ServerSettings>;
  },
  options?: Parameters<typeof makeProviderCacheTestLayer>[0],
) =>
  makeProviderCacheTestLayer(options).pipe(
    Layer.provide(makeProviderRegistryLayer(input)),
    Layer.provide(makeServerSettingsLayer(input.settingsChanges)),
  );

interface ProviderCacheTestContext {
  readonly providersRef: Ref.Ref<ReadonlyArray<ServerProvider>>;
  readonly refreshCountRef: Ref.Ref<number>;
  readonly settingsChanges: PubSub.PubSub<ServerSettings>;
}

interface GatedProviderCacheTestContext extends ProviderCacheTestContext {
  readonly refreshGate: Deferred.Deferred<void>;
}

const withProviderCacheTest = <A, E, R>(
  run: (context: ProviderCacheTestContext) => Effect.Effect<A, E, R>,
  options?: Parameters<typeof makeProviderCacheTestLayer>[0],
) =>
  Effect.gen(function* () {
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([makeProvider("gpt-5")]);
    const refreshCountRef = yield* Ref.make(0);
    const settingsChanges = yield* PubSub.unbounded<ServerSettings>();
    const layer = makeTestLayer(
      {
        providersRef,
        refreshCountRef,
        settingsChanges: Stream.fromPubSub(settingsChanges),
      },
      options,
    );

    return yield* run({
      providersRef,
      refreshCountRef,
      settingsChanges,
    }).pipe(Effect.provide(layer));
  });

const withGatedProviderCacheTest = <A, E, R>(
  run: (context: GatedProviderCacheTestContext) => Effect.Effect<A, E, R>,
  options?: Parameters<typeof makeProviderCacheTestLayer>[0],
) =>
  Effect.gen(function* () {
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([makeProvider("gpt-5")]);
    const refreshCountRef = yield* Ref.make(0);
    const settingsChanges = yield* PubSub.unbounded<ServerSettings>();
    const refreshGate = yield* Deferred.make<void>();
    const layer = makeTestLayer(
      {
        providersRef,
        refreshCountRef,
        refreshGate,
        settingsChanges: Stream.fromPubSub(settingsChanges),
      },
      options,
    );

    return yield* run({
      providersRef,
      refreshCountRef,
      settingsChanges,
      refreshGate,
    }).pipe(Effect.provide(layer));
  });

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

it.effect("caches provider model lists within the configured TTL", () =>
  withProviderCacheTest(({ refreshCountRef }) =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;

      const firstModels = yield* cache.getModelList(codexInstanceId);
      const secondModels = yield* cache.getModelList(codexInstanceId);
      const stats = yield* cache.stats;
      const snapshots = yield* Metric.snapshot;

      assert.deepStrictEqual(
        firstModels.map((model) => model.slug),
        ["gpt-5"],
      );
      assert.deepStrictEqual(secondModels, firstModels);
      assert.equal(yield* Ref.get(refreshCountRef), 1);
      assert.equal(stats.providerSnapshotEntries, 1);
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_cache_hits_total", {
          cache: "provider-models",
          key: "providers:codex",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "t3_provider_cache_misses_total", {
          cache: "provider-models",
          key: "providers:codex",
        }),
        true,
      );
    }),
  ),
);

it.effect("expires model list cache entries after their TTL", () =>
  withProviderCacheTest(
    ({ refreshCountRef }) =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;

        yield* cache.getModelList(codexInstanceId);
        yield* TestClock.adjust(Duration.seconds(6));
        yield* cache.getModelList(codexInstanceId);

        assert.equal(yield* Ref.get(refreshCountRef), 2);
      }),
    { modelListTtl: Duration.seconds(5) },
  ).pipe(Effect.provide(TestClock.layer())),
);

it.effect("deduplicates concurrent cache misses for the same provider", () =>
  withGatedProviderCacheTest(({ refreshCountRef, refreshGate }) =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;

      const fiber = yield* Effect.all(
        [
          cache.getModelList(codexInstanceId),
          cache.getModelList(codexInstanceId),
          cache.getModelList(codexInstanceId),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* Deferred.succeed(refreshGate, void 0);
      const results = yield* Fiber.join(fiber);

      assert.equal(results.length, 3);
      assert.equal(yield* Ref.get(refreshCountRef), 1);
    }),
  ),
);

it.effect("invalidates provider entries when server settings change", () =>
  withProviderCacheTest(({ refreshCountRef, settingsChanges }) =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;

      yield* Effect.yieldNow;
      yield* cache.getModelList(codexInstanceId);
      yield* PubSub.publish(settingsChanges, DEFAULT_SERVER_SETTINGS);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* cache.getModelList(codexInstanceId);

      assert.equal(yield* Ref.get(refreshCountRef), 2);
    }),
  ),
);

it.effect("caches capability snapshots separately from model list entries", () =>
  withProviderCacheTest(({ refreshCountRef }) =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;

      const first = yield* cache.getCapabilitySnapshot(codexInstanceId);
      const second = yield* cache.getCapabilitySnapshot(codexInstanceId);
      const stats = yield* cache.stats;

      assert.equal(first.models[0]?.slug, "gpt-5");
      assert.deepStrictEqual(second, first);
      assert.equal(yield* Ref.get(refreshCountRef), 1);
      assert.equal(stats.capabilityEntries, 1);
    }),
  ),
);
