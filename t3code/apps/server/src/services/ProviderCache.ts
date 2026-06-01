/**
 * Effect.Cache-based provider API response caching with TTL.
 * Caches model listings and capability queries to reduce API calls.
 */

import { Effect, Cache, Duration, pipe, Layer } from "effect";

interface CacheConfig {
  /** Default TTL for cached values (default: 5 minutes) */
  defaultTtl?: number;
  /** Maximum cache size (default: 1000) */
  maxSize?: number;
  /** Key prefix for namespacing */
  keyPrefix?: string;
}

interface CachedProvider {
  name: string;
  models: unknown[];
  capabilities: Record<string, unknown>;
  lastUpdated: number;
}

/**
 * Provider cache with Effect.Cache integration
 */
export class ProviderCache {
  private cache: Map<string, { value: unknown; expires: number }> = new Map();
  private config: Required<CacheConfig>;

  constructor(config: CacheConfig = {}) {
    this.config = {
      defaultTtl: config.defaultTtl || 5 * 60 * 1000,
      maxSize: config.maxSize || 1000,
      keyPrefix: config.keyPrefix || "provider",
    };
  }

  /**
   * Create an Effect that caches provider API responses.
   */
  cached<T>(
    key: string,
    fetcher: () => Effect.Effect<T>,
    ttl?: number
  ): Effect.Effect<T> {
    return Effect.gen(
      function* (this: ProviderCache) {
        const cacheKey = `${this.config.keyPrefix}:${key}`;
        const cached = this.getFromCache<T>(cacheKey);

        if (cached !== undefined) {
          return cached;
        }

        const value = yield* fetcher();
        this.setCache(cacheKey, value, ttl || this.config.defaultTtl);
        return value;
      }.bind(this)
    );
  }

  /**
   * Get cached value if not expired.
   */
  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Set value in cache with TTL.
   */
  private setCache(key: string, value: unknown, ttl: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + ttl,
    });
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(key: string): void {
    this.cache.delete(`${this.config.keyPrefix}:${key}`);
  }

  /**
   * Invalidate all entries matching a pattern.
   */
  invalidatePattern(pattern: string): void {
    const prefix = `${this.config.keyPrefix}:${pattern}`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats.
   */
  stats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
    };
  }
}

/**
 * Create a provider cache layer for dependency injection.
 */
export const ProviderCacheLive = (config?: CacheConfig) =>
  Layer.succeed(new ProviderCache(config));

/**
 * Helper: cache a model listing call.
 */
export const cachedModelListing = (
  cache: ProviderCache,
  provider: string,
  fetcher: () => Effect.Effect<unknown[]>
) => cache.cached(`models:${provider}`, fetcher, 5 * 60 * 1000);

/**
 * Helper: cache a capabilities query.
 */
export const cachedCapabilities = (
  cache: ProviderCache,
  provider: string,
  model: string,
  fetcher: () => Effect.Effect<Record<string, unknown>>
) => cache.cached(`caps:${provider}:${model}`, fetcher, 10 * 60 * 1000);
