/**
 * ProviderCache — In-memory response cache for provider API calls.
 *
 * Caches provider model lists (5-minute TTL) and capability queries
 * (15-minute TTL) to reduce latency and API quota consumption.
 *
 * Uses `Ref<Map>` with manual TTL expiry rather than `Effect.Cache.make`
 * because the lookup function is dynamic (provided per-call by the caller).
 * `Cache.make` requires a fixed `lookup` at construction time, which doesn't
 * fit the per-provider, per-call pattern.
 *
 * Cache invalidation on provider configuration changes is handled via
 * a direct `invalidate()` call — callers call it and all cached entries
 * for that provider are cleared.
 *
 * Cache hit/miss metrics are exposed through the observability layer using
 * `Metric.counter` with `cache_type` and `provider` attributes.
 *
 * @module services/ProviderCache
 */
import type { ProviderDriverKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

// ── Cache entry types ───────────────────────────────────────────────────

interface CacheEntry<A> {
  readonly value: A;
  readonly expiresAt: number; // ms since epoch (Date.now)
}

type CacheKey = string;

// ── Cache types ─────────────────────────────────────────────────────────

export type ProviderCacheType = "model_list" | "capability";

export const CACHE_TTL: Record<ProviderCacheType, Duration.Duration> = {
  model_list: Duration.minutes(5),
  capability: Duration.minutes(15),
};

export const CACHE_MAX_ENTRIES: Record<ProviderCacheType, number> = {
  model_list: 256,
  capability: 512,
};

// ── Metrics ─────────────────────────────────────────────────────────────

export const cacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total provider cache hits.",
});

export const cacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total provider cache misses.",
});

export const cacheInvalidationsTotal = Metric.counter("t3_provider_cache_invalidations_total", {
  description: "Total provider cache invalidations.",
});

export const cacheSize = Metric.gauge("t3_provider_cache_size", {
  description: "Current number of cached entries per cache type.",
});

const metricAttributes = (
  attrs: Readonly<Record<string, unknown>>,
): ReadonlyArray<[string, string]> => {
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    result.push([key, String(value)]);
  }
  return result;
};

// ── Service shape ───────────────────────────────────────────────────────

export interface ProviderCacheShape {
  readonly getOrCompute: <A>(
    cacheType: ProviderCacheType,
    key: string,
    provider: ProviderDriverKind,
    lookup: () => Effect.Effect<A, never, never>,
  ) => Effect.Effect<A>;

  readonly invalidate: (
    provider: ProviderDriverKind,
    cacheType?: ProviderCacheType,
  ) => Effect.Effect<void>;
}

// ── Service tag ─────────────────────────────────────────────────────────

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/services/ProviderCache",
) {}

// ── Implementation ──────────────────────────────────────────────────────

const makeCacheKey = (
  cacheType: ProviderCacheType,
  key: string,
  provider: ProviderDriverKind,
): CacheKey => `${String(provider)}::${cacheType}::${key}`;

/** Convert a Duration to milliseconds. */
const durationToMs = (dur: Duration.Duration): number => Duration.toMillis(dur);

export const makeProviderCache = Effect.fn("makeProviderCache")(function* (): Effect.fn.Return<
  ProviderCacheShape,
  never,
  never
> {
  const modelListStore = yield* Ref.make<Map<CacheKey, CacheEntry<unknown>>>(new Map());
  const capabilityStore = yield* Ref.make<Map<CacheKey, CacheEntry<unknown>>>(new Map());

  const storeForType = (
    cacheType: ProviderCacheType,
  ): Ref.Ref<Map<CacheKey, CacheEntry<unknown>>> =>
    cacheType === "model_list" ? modelListStore : capabilityStore;

  const getOrCompute: ProviderCacheShape["getOrCompute"] = <A>(
    cacheType: ProviderCacheType,
    key: string,
    provider: ProviderDriverKind,
    lookup: () => Effect.Effect<A, never, never>,
  ): Effect.Effect<A> =>
    Effect.gen(function* () {
      const now = (yield* DateTime.now).pipe(DateTime.toEpochMillis);
      const store = storeForType(cacheType);
      const cacheKey = makeCacheKey(cacheType, key, provider);

      // Try cache hit.
      const map = yield* Ref.get(store);
      const entry = map.get(cacheKey) as CacheEntry<A> | undefined;
      if (entry && entry.expiresAt > now) {
        yield* Metric.update(
          Metric.withAttributes(
            cacheHitsTotal,
            metricAttributes({
              cache_type: cacheType,
              provider: String(provider),
            }),
          ),
          1,
        );
        return entry.value;
      }

      // Cache miss.
      yield* Metric.update(
        Metric.withAttributes(
          cacheMissesTotal,
          metricAttributes({
            cache_type: cacheType,
            provider: String(provider),
          }),
        ),
        1,
      );

      const value = yield* lookup();
      const ttlMs = durationToMs(CACHE_TTL[cacheType]);
      const expiresAt = now + ttlMs;

      yield* Ref.update(store, (m) => {
        const next = new Map(m);
        next.set(cacheKey, { value, expiresAt } as CacheEntry<unknown>);

        const max = CACHE_MAX_ENTRIES[cacheType];
        if (next.size > max) {
          const entries = [...next.entries()].sort(([, a], [, b]) => a.expiresAt - b.expiresAt);
          const toRemove = entries.slice(0, next.size - max);
          for (const [k] of toRemove) {
            next.delete(k);
          }
        }
        return next;
      });

      const currentSize = (yield* Ref.get(store)).size;
      yield* Metric.update(
        Metric.withAttributes(cacheSize, metricAttributes({ cache_type: cacheType })),
        currentSize,
      );

      return value;
    });

  const invalidate: ProviderCacheShape["invalidate"] = (
    provider: ProviderDriverKind,
    cacheType?: ProviderCacheType,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const typesToClear: ReadonlyArray<ProviderCacheType> = cacheType
        ? [cacheType]
        : ["model_list", "capability"];

      for (const ct of typesToClear) {
        const store = storeForType(ct);
        const prefix = `${String(provider)}::${ct}::`;

        yield* Ref.update(store, (m) => {
          const next = new Map(m);
          for (const key of next.keys()) {
            if (key.startsWith(prefix)) {
              next.delete(key);
            }
          }
          return next;
        });
      }

      yield* Metric.update(
        Metric.withAttributes(
          cacheInvalidationsTotal,
          metricAttributes({
            provider: String(provider),
            cache_type: cacheType ?? "all",
          }),
        ),
        1,
      );
    });

  return { getOrCompute, invalidate };
});

// ── Layer ───────────────────────────────────────────────────────────────

export const ProviderCacheLive = Layer.effect(ProviderCache, makeProviderCache());
