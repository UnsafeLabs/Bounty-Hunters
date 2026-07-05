import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Metrics from "../observability/Metrics.ts";

export const DEFAULT_PROVIDER_MODEL_LIST_TTL = Duration.minutes(5);
export const DEFAULT_PROVIDER_CAPABILITY_TTL = Duration.minutes(15);

export interface ProviderCacheStats {
  readonly modelHits: number;
  readonly modelMisses: number;
  readonly capabilityHits: number;
  readonly capabilityMisses: number;
  readonly invalidations: number;
}

export interface ProviderCacheOptions {
  readonly capacity?: number;
  readonly modelListTtl?: Duration.Input;
  readonly capabilityTtl?: Duration.Input;
}

export interface ProviderRefreshInput {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly refresh: Effect.Effect<ServerProvider>;
}

type CacheKind = "models" | "capabilities";
type CacheOutcome = "hit" | "miss";
type ProviderModel = ServerProvider["models"][number];
type ModelCapabilities = NonNullable<ProviderModel["capabilities"]>;
type CapabilityMap = ReadonlyMap<string, ModelCapabilities>;

interface ProviderRefreshLoader {
  readonly driver: ProviderDriverKind;
  readonly refresh: Effect.Effect<ServerProvider>;
}

const initialStats: ProviderCacheStats = {
  modelHits: 0,
  modelMisses: 0,
  capabilityHits: 0,
  capabilityMisses: 0,
  invalidations: 0,
};

const incrementStats = (
  stats: ProviderCacheStats,
  kind: CacheKind,
  outcome: CacheOutcome,
): ProviderCacheStats => {
  if (kind === "models") {
    return outcome === "hit"
      ? { ...stats, modelHits: stats.modelHits + 1 }
      : { ...stats, modelMisses: stats.modelMisses + 1 };
  }
  return outcome === "hit"
    ? { ...stats, capabilityHits: stats.capabilityHits + 1 }
    : { ...stats, capabilityMisses: stats.capabilityMisses + 1 };
};

const collectCapabilities = (models: ReadonlyArray<ProviderModel>): CapabilityMap => {
  const capabilities = new Map<string, ModelCapabilities>();
  for (const model of models) {
    if (model.capabilities !== null) {
      capabilities.set(model.slug, model.capabilities);
    }
  }
  return capabilities;
};

const applyCachedCapabilities = (provider: ServerProvider, capabilities: CapabilityMap) => {
  if (capabilities.size === 0) {
    return provider;
  }

  return {
    ...provider,
    models: provider.models.map((model) => {
      if (model.capabilities !== null) {
        return model;
      }
      const cachedCapabilities = capabilities.get(model.slug);
      return cachedCapabilities ? { ...model, capabilities: cachedCapabilities } : model;
    }),
  } satisfies ServerProvider;
};

export const makeProviderCache = Effect.fn("makeProviderCache")(function* (
  options: ProviderCacheOptions = {},
) {
  const capacity = options.capacity ?? 64;
  const modelListTtl = options.modelListTtl ?? DEFAULT_PROVIDER_MODEL_LIST_TTL;
  const capabilityTtl = options.capabilityTtl ?? DEFAULT_PROVIDER_CAPABILITY_TTL;
  const loadersRef = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ProviderRefreshLoader>>(
    new Map(),
  );
  const statsRef = yield* Ref.make<ProviderCacheStats>(initialStats);

  const recordAccess = (input: ProviderRefreshInput, kind: CacheKind, outcome: CacheOutcome) =>
    Ref.update(statsRef, (stats) => incrementStats(stats, kind, outcome)).pipe(
      Effect.andThen(
        Metrics.increment(Metrics.providerCacheRequestsTotal, {
          provider: input.driver,
          instanceId: input.instanceId,
          cache: kind,
          outcome,
        }),
      ),
    );

  const modelListCache = yield* Cache.makeWith<ProviderInstanceId, ServerProvider>(
    (instanceId) =>
      Ref.get(loadersRef).pipe(
        Effect.flatMap((loaders) => {
          const loader = loaders.get(instanceId);
          if (!loader) {
            return Effect.die(
              new Error(`No provider refresh loader registered for '${instanceId}'.`),
            );
          }
          return loader.refresh;
        }),
      ),
    {
      capacity,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? modelListTtl : Duration.zero),
    },
  );

  const capabilityCache = yield* Cache.makeWith<ProviderInstanceId, CapabilityMap>(
    (instanceId) =>
      Cache.get(modelListCache, instanceId).pipe(
        Effect.map((provider) => collectCapabilities(provider.models)),
      ),
    {
      capacity,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? capabilityTtl : Duration.zero),
    },
  );

  const refreshProvider = Effect.fn("ProviderCache.refreshProvider")(function* (
    input: ProviderRefreshInput,
  ) {
    yield* Ref.update(loadersRef, (loaders) => {
      const next = new Map(loaders);
      next.set(input.instanceId, {
        driver: input.driver,
        refresh: input.refresh,
      });
      return next;
    });

    const modelOption = yield* Cache.getOption(modelListCache, input.instanceId);
    yield* recordAccess(input, "models", Option.isSome(modelOption) ? "hit" : "miss");
    const provider = yield* Cache.get(modelListCache, input.instanceId);

    const capabilityOption = yield* Cache.getOption(capabilityCache, input.instanceId);
    yield* recordAccess(input, "capabilities", Option.isSome(capabilityOption) ? "hit" : "miss");
    const capabilities = yield* Cache.get(capabilityCache, input.instanceId);

    return applyCachedCapabilities(provider, capabilities);
  });

  const invalidateProvider = Effect.fn("ProviderCache.invalidateProvider")(function* (
    instanceId: ProviderInstanceId,
  ) {
    yield* Cache.invalidate(modelListCache, instanceId);
    yield* Cache.invalidate(capabilityCache, instanceId);
    yield* Ref.update(statsRef, (stats) => ({
      ...stats,
      invalidations: stats.invalidations + 1,
    }));
  });

  const rememberProvider = Effect.fn("ProviderCache.rememberProvider")(function* (
    provider: ServerProvider,
  ) {
    yield* Cache.set(modelListCache, provider.instanceId, provider);
    const capabilities = collectCapabilities(provider.models);
    if (capabilities.size > 0) {
      yield* Cache.set(capabilityCache, provider.instanceId, capabilities);
    }
  });

  const invalidateAll = Effect.fn("ProviderCache.invalidateAll")(function* () {
    const instanceIds = yield* Cache.keys(modelListCache);
    yield* Effect.forEach(instanceIds, invalidateProvider, { discard: true });
  });

  return {
    refreshProvider,
    rememberProvider,
    invalidateProvider,
    invalidateAll,
    getStats: Ref.get(statsRef),
  } as const;
});
