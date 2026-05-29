import {
  ProviderInstanceId,
  type ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { increment, providerCacheHits, providerCacheMisses } from "../../observability/Metrics.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderRegistry } from "../Services/ProviderRegistry.ts";
import {
  ProviderCache,
  ProviderCacheLookupError,
  type ProviderCacheShape,
  type ProviderCapabilitySnapshot,
} from "../Services/ProviderCache.ts";

export interface ProviderCacheOptions {
  readonly modelListTtl?: Duration.Input;
  readonly capabilityTtl?: Duration.Input;
  readonly capacity?: number;
}

const DEFAULT_PROVIDER_CACHE_CAPACITY = 64;
const DEFAULT_MODEL_LIST_TTL = Duration.minutes(5);
const DEFAULT_CAPABILITY_TTL = Duration.minutes(15);
const ALL_PROVIDERS_CACHE_KEY = "providers:all";

const providerCacheKey = (instanceId: ProviderInstanceId): string =>
  `providers:${String(instanceId)}`;
const capabilityCacheKey = (instanceId: ProviderInstanceId): string =>
  `capabilities:${String(instanceId)}`;

const providerFromSnapshots = (
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
) => {
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  if (!provider) {
    return Effect.fail(
      new ProviderCacheLookupError({
        message: `No provider snapshot found for instance '${String(instanceId)}'.`,
        instanceId,
      }),
    );
  }
  return Effect.succeed(provider);
};

const capabilitySnapshotFromProvider = (provider: ServerProvider): ProviderCapabilitySnapshot => ({
  instanceId: provider.instanceId,
  driver: provider.driver,
  models: provider.models.map((model) => ({
    slug: model.slug,
    capabilities: model.capabilities,
  })),
});

const trackCacheLookup = <A, E>(
  cacheType: "provider-models" | "provider-capabilities",
  key: string,
  getCached: Effect.Effect<Option.Option<A>, E>,
  getFresh: Effect.Effect<A, E>,
) =>
  getCached.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => getFresh,
        onSome: (value) =>
          increment(providerCacheHits, {
            cache: cacheType,
            key,
          }).pipe(Effect.as(value)),
      }),
    ),
  );

const makeProviderCache = Effect.fn("makeProviderCache")(function* (
  options: ProviderCacheOptions = {},
) {
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_PROVIDER_CACHE_CAPACITY));
  const modelListTtl = options.modelListTtl ?? DEFAULT_MODEL_LIST_TTL;
  const capabilityTtl = options.capabilityTtl ?? DEFAULT_CAPABILITY_TTL;

  const providerSnapshotCache = yield* Cache.make<string, ReadonlyArray<ServerProvider>>({
    capacity,
    timeToLive: modelListTtl,
    lookup: (key) =>
      increment(providerCacheMisses, {
        cache: "provider-models",
        key,
      }).pipe(
        Effect.andThen(
          key === ALL_PROVIDERS_CACHE_KEY
            ? providerRegistry.refresh()
            : providerRegistry.refreshInstance(
                ProviderInstanceId.make(key.slice("providers:".length)),
              ),
        ),
      ),
  });

  const capabilityCache = yield* Cache.make<
    string,
    ProviderCapabilitySnapshot,
    ProviderCacheLookupError
  >({
    capacity,
    timeToLive: capabilityTtl,
    lookup: (key) => {
      const instanceId = ProviderInstanceId.make(key.slice("capabilities:".length));
      return increment(providerCacheMisses, {
        cache: "provider-capabilities",
        key,
      }).pipe(
        Effect.andThen(providerRegistry.refreshInstance(instanceId)),
        Effect.flatMap((providers) => providerFromSnapshots(providers, instanceId)),
        Effect.map(capabilitySnapshotFromProvider),
      );
    },
  });

  const refresh: ProviderCacheShape["refresh"] = (provider?: ProviderDriverKind) =>
    provider === undefined
      ? trackCacheLookup(
          "provider-models",
          ALL_PROVIDERS_CACHE_KEY,
          Cache.getOption(providerSnapshotCache, ALL_PROVIDERS_CACHE_KEY),
          Cache.get(providerSnapshotCache, ALL_PROVIDERS_CACHE_KEY),
        )
      : providerRegistry.refresh(provider);

  const refreshInstance: ProviderCacheShape["refreshInstance"] = (instanceId) => {
    const key = providerCacheKey(instanceId);
    return trackCacheLookup(
      "provider-models",
      key,
      Cache.getOption(providerSnapshotCache, key),
      Cache.get(providerSnapshotCache, key),
    );
  };

  const getModelList: ProviderCacheShape["getModelList"] = (instanceId) =>
    refreshInstance(instanceId).pipe(
      Effect.flatMap((providers) => providerFromSnapshots(providers, instanceId)),
      Effect.map((provider) => provider.models),
    );

  const getCapabilitySnapshot: ProviderCacheShape["getCapabilitySnapshot"] = (instanceId) => {
    const key = capabilityCacheKey(instanceId);
    return trackCacheLookup(
      "provider-capabilities",
      key,
      Cache.getOption(capabilityCache, key),
      Cache.get(capabilityCache, key),
    );
  };

  const invalidateInstance: ProviderCacheShape["invalidateInstance"] = (instanceId) =>
    Effect.all(
      [
        Cache.invalidate(providerSnapshotCache, providerCacheKey(instanceId)),
        Cache.invalidate(capabilityCache, capabilityCacheKey(instanceId)),
      ],
      { discard: true },
    );

  const invalidateAll = Effect.all(
    [Cache.invalidateAll(providerSnapshotCache), Cache.invalidateAll(capabilityCache)],
    { discard: true },
  );

  yield* Stream.runForEach(serverSettings.streamChanges, () => invalidateAll).pipe(
    Effect.forkScoped,
  );

  return {
    getProviders: providerRegistry.getProviders,
    refresh,
    refreshInstance,
    getModelList,
    getCapabilitySnapshot,
    invalidateInstance,
    invalidateAll,
    stats: Effect.all({
      providerSnapshotEntries: Cache.size(providerSnapshotCache),
      capabilityEntries: Cache.size(capabilityCache),
    }),
  } satisfies ProviderCacheShape;
});

export const ProviderCacheLive = Layer.effect(ProviderCache, makeProviderCache());

export const makeProviderCacheTestLayer = (options?: ProviderCacheOptions) =>
  Layer.effect(ProviderCache, makeProviderCache(options));
