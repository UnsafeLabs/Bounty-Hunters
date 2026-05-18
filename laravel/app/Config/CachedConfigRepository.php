<?php

namespace App\Config;

use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Contracts\Config\Repository as ConfigRepository;

/**
 * Fix: Add caching layer to config loading and fix cache store
 * connection validation (#747)
 *
 * Problem: Config loaded from files on every request, no caching.
 * Cache store connection not validated, causing silent failures.
 *
 * Solution: Cache config values with TTL, validate cache connection
 * before use, fallback to file-based config on cache failure.
 */
class CachedConfigRepository implements ConfigRepository
{
    private const CACHE_PREFIX = 'config:';
    private const DEFAULT_TTL = 3600; // 1 hour

    private array $cached = [];
    private bool $cacheAvailable;

    public function __construct(
        private readonly ConfigRepository $fallback,
        private readonly CacheRepository $cache,
        private readonly int $ttl = self::DEFAULT_TTL,
    ) {
        $this->cacheAvailable = $this->validateCacheConnection();
    }

    /**
     * Validate cache store connection before use
     */
    private function validateCacheConnection(): bool
    {
        try {
            $testKey = self::CACHE_PREFIX . '__ping__';
            $this->cache->put($testKey, '1', 1);
            $result = $this->cache->get($testKey);
            $this->cache->forget($testKey);
            return $result === '1';
        } catch (\Throwable $e) {
            \Log::warning('Cache connection failed, falling back to file config', [
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Check if cache store connection is still healthy
     */
    public function isCacheHealthy(): bool
    {
        return $this->cacheAvailable;
    }

    /**
     * Reconnect and revalidate cache
     */
    public function reconnectCache(): bool
    {
        // Reset store connection if applicable
        if (method_exists($this->cache->getStore(), 'reconnect')) {
            $this->cache->getStore()->reconnect();
        }
        $this->cacheAvailable = $this->validateCacheConnection();
        return $this->cacheAvailable;
    }

    public function get($key, $default = null): mixed
    {
        // Check in-memory cache first
        if (isset($this->cached[$key])) {
            return $this->cached[$key];
        }

        // Try external cache
        if ($this->cacheAvailable) {
            try {
                $cached = $this->cache->get(self::CACHE_PREFIX . $key);
                if ($cached !== null) {
                    $this->cached[$key] = $cached;
                    return $cached;
                }
            } catch (\Throwable $e) {
                $this->cacheAvailable = false;
                \Log::warning('Cache read failed, degrading', [
                    'key' => $key,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Fallback to file config
        $value = $this->fallback->get($key, $default);

        // Warm cache on miss
        if ($this->cacheAvailable && $value !== null) {
            try {
                $this->cache->put(self::CACHE_PREFIX . $key, $value, $this->ttl);
            } catch (\Throwable $e) {
                $this->cacheAvailable = false;
            }
        }

        $this->cached[$key] = $value;
        return $value;
    }

    public function set($key, $value = null): void
    {
        $this->fallback->set($key, $value);
        $this->cached[$key] = $value;

        if ($this->cacheAvailable) {
            try {
                $this->cache->put(self::CACHE_PREFIX . $key, $value, $this->ttl);
            } catch (\Throwable $e) {
                $this->cacheAvailable = false;
            }
        }
    }

    public function has($key): bool
    {
        return $this->get($key) !== null;
    }

    public function all(): array
    {
        return $this->fallback->all();
    }

    public function prepend($key, $value): void
    {
        $this->fallback->prepend($key, $value);
        unset($this->cached[$key]);

        if ($this->cacheAvailable) {
            try {
                $this->cache->forget(self::CACHE_PREFIX . $key);
            } catch (\Throwable) {}
        }
    }

    public function push($key, $value): void
    {
        $this->fallback->push($key, $value);
        unset($this->cached[$key]);

        if ($this->cacheAvailable) {
            try {
                $this->cache->forget(self::CACHE_PREFIX . $key);
            } catch (\Throwable) {}
        }
    }

    /**
     * Flush all cached config entries
     */
    public function flushCache(): bool
    {
        $this->cached = [];
        if ($this->cacheAvailable) {
            try {
                // Flush all config: prefixed keys
                if (method_exists($this->cache->getStore(), 'flush')) {
                    return $this->cache->getStore()->flush();
                }
            } catch (\Throwable) {}
        }
        return false;
    }
}
