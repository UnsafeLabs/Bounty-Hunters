/**
 * ProviderCache - Effect.Cache-backed caching for provider API responses.
 *
 * Provider model lists and capability queries are read repeatedly by transport
 * layers but change rarely. This service memoizes both behind `effect/Cache`
 * instances with independent, configurable TTLs so that requests within the TTL
 * are served without touching the underlying provider API.
 *
 * `effect/Cache` also deduplicates concurrent lookups of the same key: when many
 * fibers request an uncached entry simultaneously the lookup effect runs exactly
 * once and every caller receives that single result. Memory is bounded by the
 * per-cache `capacity` knob.
 *
 * The pure factory `makeProviderCache` takes the lookup functions and TTL
 * configuration as arguments, which keeps it side-effect free and testable in
 * isolation. `ProviderCacheLive` wires the factory to the real provider services
 * and invalidates only the affected instances whenever the provider registry
 * reports a change.
 *
 * @module ProviderCache
 */
import type { ProviderInstanceId, ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  increment,
  providerCacheHitsTotal,
  providerCacheMissesTotal,
} from "../observability/Metrics.ts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";

/** Identifies which cache an operation touched, used for metrics and errors. */
export type ProviderCacheKind = "models" | "capabilities";

/** Raised when the cache cannot satisfy a lookup or is misconfigured. */
export class ProviderCacheError extends Data.TaggedError("ProviderCacheError")<{
  readonly cache: ProviderCacheKind;
  readonly instanceId?: ProviderInstanceId | undefined;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

/** Per-cache-type TTLs and the shared entry-count bound. */
export interface ProviderCacheConfig {
  /** Time provider model lists remain fresh before a re-fetch. */
  readonly modelListTtl: Duration.Duration;
  /** Time provider capability queries remain fresh before a re-fetch. */
  readonly capabilityTtl: Duration.Duration;
  /** Maximum number of entries retained per cache (bounds memory usage). */
  readonly capacity: number;
}

/** Defaults requested by the issue: 5-minute models, 15-minute capabilities. */
export const defaultProviderCacheConfig: ProviderCacheConfig = {
  modelListTtl: Duration.minutes(5),
  capabilityTtl: Duration.minutes(15),
  capacity: 256,
};

/** Cumulative cache effectiveness, exposed for the observability layer. */
export interface ProviderCacheStats {
  readonly hits: number;
  readonly misses: number;
}

/** Lookup functions invoked on a cache miss to fetch fresh provider data. */
export interface ProviderCacheLookups {
  readonly fetchModels: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderModel>, ProviderCacheError>;
  readonly fetchCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderCacheError>;
}

export interface ProviderCacheShape {
  /** Read a provider's model list, served from cache within its TTL. */
  readonly getModels: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderModel>, ProviderCacheError>;

  /** Read a provider's capabilities, served from cache within its TTL. */
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderCacheError>;

  /** Drop every cached entry for a single provider instance. */
  readonly invalidateProvider: (instanceId: ProviderInstanceId) => Effect.Effect<void>;

  /** Drop every cached entry across all providers. */
  readonly invalidateAll: Effect.Effect<void>;

  /** Snapshot of cumulative cache hits and misses. */
  readonly stats: Effect.Effect<ProviderCacheStats>;
}

const assertCapacity = (capacity: number): Effect.Effect<void, ProviderCacheError> =>
  Number.isInteger(capacity) && capacity > 0
    ? Effect.void
    : Effect.fail(
        new ProviderCacheError({
          cache: "models",
          detail: `cache capacity must be a positive integer, received ${capacity}`,
        }),
      );

/**
 * Build a provider cache from explicit lookups and configuration. Pure: it
 * allocates the caches and a stats counter but performs no I/O and starts no
 * background fibers, so it can be exercised directly in tests.
 */
export const makeProviderCache = (options: {
  readonly config: ProviderCacheConfig;
  readonly lookups: ProviderCacheLookups;
}) =>
  Effect.gen(function* () {
    const { config, lookups } = options;
    yield* assertCapacity(config.capacity);

    const modelsCache = yield* Cache.make<
      ProviderInstanceId,
      ReadonlyArray<ServerProviderModel>,
      ProviderCacheError
    >({
      capacity: config.capacity,
      timeToLive: config.modelListTtl,
      lookup: (instanceId) => lookups.fetchModels(instanceId),
    });

    const capabilitiesCache = yield* Cache.make<
      ProviderInstanceId,
      ProviderAdapterCapabilities,
      ProviderCacheError
    >({
      capacity: config.capacity,
      timeToLive: config.capabilityTtl,
      lookup: (instanceId) => lookups.fetchCapabilities(instanceId),
    });

    const statsRef = yield* Ref.make<ProviderCacheStats>({ hits: 0, misses: 0 });

    const recordHit = (cache: ProviderCacheKind) =>
      Effect.gen(function* () {
        yield* Ref.update(statsRef, (current) => ({ ...current, hits: current.hits + 1 }));
        yield* increment(providerCacheHitsTotal, { cache });
      });

    const recordMiss = (cache: ProviderCacheKind) =>
      Effect.gen(function* () {
        yield* Ref.update(statsRef, (current) => ({ ...current, misses: current.misses + 1 }));
        yield* increment(providerCacheMissesTotal, { cache });
      });

    // A present entry is a hit; an absent one delegates to `Cache.get`, which
    // performs (and deduplicates) the lookup and stores the fresh value.
    const observe = <Value>(
      cache: ProviderCacheKind,
      peek: Effect.Effect<Option.Option<Value>, ProviderCacheError>,
      load: Effect.Effect<Value, ProviderCacheError>,
    ): Effect.Effect<Value, ProviderCacheError> =>
      peek.pipe(
        Effect.flatMap((cached) =>
          Option.isSome(cached)
            ? recordHit(cache).pipe(Effect.as(cached.value))
            : load.pipe(Effect.tap(() => recordMiss(cache))),
        ),
      );

    const invalidateAll = Effect.gen(function* () {
      const modelKeys = Array.from(yield* Cache.keys(modelsCache));
      yield* Effect.forEach(modelKeys, (key) => Cache.invalidate(modelsCache, key), {
        concurrency: 1,
      }).pipe(Effect.asVoid);
      const capabilityKeys = Array.from(yield* Cache.keys(capabilitiesCache));
      yield* Effect.forEach(capabilityKeys, (key) => Cache.invalidate(capabilitiesCache, key), {
        concurrency: 1,
      }).pipe(Effect.asVoid);
    });

    return {
      getModels: (instanceId) =>
        observe(
          "models",
          Cache.getOption(modelsCache, instanceId),
          Cache.get(modelsCache, instanceId),
        ),
      getCapabilities: (instanceId) =>
        observe(
          "capabilities",
          Cache.getOption(capabilitiesCache, instanceId),
          Cache.get(capabilitiesCache, instanceId),
        ),
      invalidateProvider: (instanceId) =>
        Effect.zipRight(
          Cache.invalidate(modelsCache, instanceId),
          Cache.invalidate(capabilitiesCache, instanceId),
        ),
      invalidateAll,
      stats: Ref.get(statsRef),
    } satisfies ProviderCacheShape;
  });

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/services/ProviderCache",
) {}

/**
 * Live cache wired to the real provider services. Model lists are read from the
 * provider registry snapshot; capabilities from {@link ProviderService}. A
 * background fiber subscribes to registry changes and invalidates only the
 * instances whose snapshot actually changed, so reconfigured providers never
 * serve stale data while unrelated providers keep their cached entries.
 */
export const ProviderCacheLive = Layer.effect(
  ProviderCache,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const registry = yield* ProviderRegistry;

    const fetchModels: ProviderCacheLookups["fetchModels"] = (instanceId) =>
      registry.getProviders.pipe(
        Effect.flatMap((providers) => {
          const match = providers.find((provider) => provider.instanceId === instanceId);
          return match
            ? Effect.succeed(match.models)
            : Effect.fail(
                new ProviderCacheError({
                  cache: "models",
                  instanceId,
                  detail: "no provider snapshot found for instance",
                }),
              );
        }),
      );

    const fetchCapabilities: ProviderCacheLookups["fetchCapabilities"] = (instanceId) =>
      providerService.getCapabilities(instanceId).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderCacheError({
              cache: "capabilities",
              instanceId,
              detail: "failed to resolve provider capabilities",
              cause,
            }),
        ),
      );

    const cache = yield* makeProviderCache({
      config: defaultProviderCacheConfig,
      lookups: { fetchModels, fetchCapabilities },
    });

    // `streamChanges` emits the full provider snapshot on every aggregated
    // change and never names which instance changed. We recover per-instance
    // granularity by diffing each emission against the previous snapshot and
    // invalidating only the instances whose snapshot actually changed (or were
    // removed), so reconfiguring one provider does not evict another's cache.
    const snapshotKey = (provider: ServerProvider): string => JSON.stringify(provider);
    const toSnapshotMap = (providers: ReadonlyArray<ServerProvider>) =>
      new Map(providers.map((provider) => [provider.instanceId, snapshotKey(provider)] as const));

    const previousSnapshot = yield* Ref.make(toSnapshotMap(yield* registry.getProviders));

    const reconcile = (providers: ReadonlyArray<ServerProvider>) =>
      Effect.gen(function* () {
        const next = toSnapshotMap(providers);
        const previous = yield* Ref.getAndSet(previousSnapshot, next);
        const changed = new Set<ProviderInstanceId>();
        for (const [instanceId, key] of next) {
          if (previous.get(instanceId) !== key) changed.add(instanceId);
        }
        for (const instanceId of previous.keys()) {
          if (!next.has(instanceId)) changed.add(instanceId);
        }
        yield* Effect.forEach(changed, (instanceId) => cache.invalidateProvider(instanceId), {
          discard: true,
        });
      });

    yield* Effect.forkScoped(Stream.runForEach(registry.streamChanges, reconcile));

    return cache;
  }),
);
