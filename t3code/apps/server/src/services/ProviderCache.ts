/**
 * Provider API response cache (issue #865).
 *
 * TTL caches for model lists (default 5m) and capability queries (default 15m).
 * Concurrent lookups for the same key share one in-flight promise (single-flight).
 * Invalidation by provider id clears all keys for that provider.
 */

export type CacheKind = "models" | "capabilities";

export type ProviderCacheConfig = {
  modelsTtlMs: number;
  capabilitiesTtlMs: number;
  maxEntries: number;
};

export type CacheMetrics = {
  hits: number;
  misses: number;
  invalidations: number;
};

type Entry<T> = {
  value: T;
  expiresAt: number;
  providerId: string;
  kind: CacheKind;
};

const DEFAULT_CONFIG: ProviderCacheConfig = {
  modelsTtlMs: 5 * 60 * 1000,
  capabilitiesTtlMs: 15 * 60 * 1000,
  maxEntries: 256,
};

function keyOf(providerId: string, kind: CacheKind, subKey = ""): string {
  return `${providerId}::${kind}::${subKey}`;
}

/**
 * In-memory provider cache with TTL, single-flight, and hit/miss metrics.
 * API mirrors Effect.Cache.make lookup semantics for integration with Effect layers.
 */
export class ProviderCache {
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly config: ProviderCacheConfig;
  readonly metrics: CacheMetrics = { hits: 0, misses: 0, invalidations: 0 };

  constructor(config: Partial<ProviderCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  ttlFor(kind: CacheKind): number {
    return kind === "models" ? this.config.modelsTtlMs : this.config.capabilitiesTtlMs;
  }

  hitRatio(): number {
    const total = this.metrics.hits + this.metrics.misses;
    return total === 0 ? 0 : this.metrics.hits / total;
  }

  size(): number {
    return this.store.size;
  }

  /**
   * Get or compute a value. Concurrent callers for the same key share one lookup.
   */
  async getOrLoad<T>(
    providerId: string,
    kind: CacheKind,
    lookup: () => Promise<T>,
    subKey = "",
  ): Promise<T> {
    const k = keyOf(providerId, kind, subKey);
    const now = Date.now();
    const existing = this.store.get(k);
    if (existing && existing.expiresAt > now) {
      this.metrics.hits += 1;
      return existing.value as T;
    }

    const pending = this.inflight.get(k);
    if (pending) {
      this.metrics.hits += 1; // coalesced wait counts as shared hit for dedup semantics
      return pending as Promise<T>;
    }

    this.metrics.misses += 1;
    const promise = (async () => {
      try {
        const value = await lookup();
        this.store.set(k, {
          value,
          expiresAt: Date.now() + this.ttlFor(kind),
          providerId,
          kind,
        });
        this.evictIfNeeded();
        return value;
      } finally {
        this.inflight.delete(k);
      }
    })();
    this.inflight.set(k, promise);
    return promise;
  }

  /** Invalidate all cache entries for a provider (config change). */
  invalidateProvider(providerId: string): number {
    let n = 0;
    for (const [k, entry] of this.store) {
      if (entry.providerId === providerId) {
        this.store.delete(k);
        n += 1;
      }
    }
    this.metrics.invalidations += n;
    return n;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.config.maxEntries) {
      const first = this.store.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.store.delete(first);
    }
  }
}

/** Singleton default cache used by services. */
export const providerCache = new ProviderCache();
