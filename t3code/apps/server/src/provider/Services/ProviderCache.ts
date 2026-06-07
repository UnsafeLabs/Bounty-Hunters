/**
 * ProviderCache - bounded TTL cache for provider API responses.
 *
 * Keeps expensive provider model-list refreshes and adapter capability reads
 * deduplicated while preserving explicit invalidation on provider config
 * changes.
 *
 * @module ProviderCache
 */
import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { increment, providerCacheRequestsTotal } from "../../observability/Metrics.ts";
import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";

export interface ProviderCacheConfig {
  readonly modelListTtl?: Duration.Input;
  readonly capabilityTtl?: Duration.Input;
  readonly maxEntries?: number;
}

export interface ProviderCacheStats {
  readonly modelList: {
    readonly hits: number;
    readonly misses: number;
  };
  readonly capabilities: {
    readonly hits: number;
    readonly misses: number;
  };
}

type CacheType = keyof ProviderCacheStats;
type Loader<A> = Effect.Effect<A, unknown>;

export interface ProviderCacheShape {
  readonly getModelList: <E>(
    instanceId: ProviderInstanceId,
    lookup: Effect.Effect<ServerProvider, E>,
  ) => Effect.Effect<ServerProvider, E>;
  readonly getCapabilities: <E>(
    instanceId: ProviderInstanceId,
    lookup: Effect.Effect<ProviderAdapterCapabilities, E>,
  ) => Effect.Effect<ProviderAdapterCapabilities, E>;
  readonly invalidateProvider: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
  readonly getStats: Effect.Effect<ProviderCacheStats>;
}

const DEFAULT_MODEL_LIST_TTL = Duration.minutes(5);
const DEFAULT_CAPABILITY_TTL = Duration.minutes(15);
const DEFAULT_MAX_ENTRIES = 256;

const emptyStats = (): ProviderCacheStats => ({
  modelList: { hits: 0, misses: 0 },
  capabilities: { hits: 0, misses: 0 },
});

const updateStats = (
  statsRef: Ref.Ref<ProviderCacheStats>,
  cacheType: CacheType,
  outcome: "hit" | "miss",
) =>
  Ref.update(statsRef, (stats) => ({
    ...stats,
    [cacheType]: {
      ...stats[cacheType],
      [outcome === "hit" ? "hits" : "misses"]:
        stats[cacheType][outcome === "hit" ? "hits" : "misses"] + 1,
    },
  }));

export const makeProviderCache = (config: ProviderCacheConfig = {}) =>
  Effect.gen(function* () {
    const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const statsRef = yield* Ref.make(emptyStats());
    const modelListLoaders = yield* Ref.make(new Map<ProviderInstanceId, Loader<ServerProvider>>());
    const capabilityLoaders = yield* Ref.make(
      new Map<ProviderInstanceId, Loader<ProviderAdapterCapabilities>>(),
    );

    const modelListCache = yield* Cache.make<ProviderInstanceId, ServerProvider, unknown>({
      capacity: maxEntries,
      timeToLive: config.modelListTtl ?? DEFAULT_MODEL_LIST_TTL,
      lookup: (instanceId) =>
        Ref.get(modelListLoaders).pipe(
          Effect.flatMap((loaders) => loaders.get(instanceId) ?? Effect.die("missing model loader")),
        ),
    });

    const capabilityCache = yield* Cache.make<
      ProviderInstanceId,
      ProviderAdapterCapabilities,
      unknown
    >({
      capacity: maxEntries,
      timeToLive: config.capabilityTtl ?? DEFAULT_CAPABILITY_TTL,
      lookup: (instanceId) =>
        Ref.get(capabilityLoaders).pipe(
          Effect.flatMap(
            (loaders) => loaders.get(instanceId) ?? Effect.die("missing capability loader"),
          ),
        ),
    });

    const cached = <A, E>(input: {
      readonly cacheType: CacheType;
      readonly cache: Cache.Cache<ProviderInstanceId, A, unknown>;
      readonly loadersRef: Ref.Ref<Map<ProviderInstanceId, Loader<A>>>;
      readonly instanceId: ProviderInstanceId;
      readonly lookup: Effect.Effect<A, E>;
    }): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        yield* Ref.update(input.loadersRef, (loaders) => {
          const next = new Map(loaders);
          next.set(input.instanceId, input.lookup as Loader<A>);
          return next;
        });
        const hasEntry = yield* Cache.has(input.cache, input.instanceId);
        const outcome = hasEntry ? "hit" : "miss";
        yield* updateStats(statsRef, input.cacheType, outcome);
        yield* increment(providerCacheRequestsTotal, {
          cache: input.cacheType,
          outcome,
          providerInstanceId: input.instanceId,
        });
        return (yield* Cache.get(input.cache, input.instanceId)) as A;
      }) as Effect.Effect<A, E>;

    const invalidateProvider = (instanceId: ProviderInstanceId) =>
      Effect.all(
        [Cache.invalidate(modelListCache, instanceId), Cache.invalidate(capabilityCache, instanceId)],
        { discard: true },
      );

    return {
      getModelList: (instanceId, lookup) =>
        cached({
          cacheType: "modelList",
          cache: modelListCache,
          loadersRef: modelListLoaders,
          instanceId,
          lookup,
        }),
      getCapabilities: (instanceId, lookup) =>
        cached({
          cacheType: "capabilities",
          cache: capabilityCache,
          loadersRef: capabilityLoaders,
          instanceId,
          lookup,
        }),
      invalidateProvider,
      invalidateAll: Effect.all(
        [Cache.invalidateAll(modelListCache), Cache.invalidateAll(capabilityCache)],
        { discard: true },
      ),
      getStats: Ref.get(statsRef),
    } satisfies ProviderCacheShape;
  });

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/provider/Services/ProviderCache",
) {}
