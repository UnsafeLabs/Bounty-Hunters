<?php

namespace App\Services;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Contracts\Config\Repository as ConfigRepository;
use Illuminate\Support\Str;
use Throwable;

class CacheHealthCheck
{
    private static ?array $cachedStatus = null;

    private static ?string $cachedSignature = null;

    private static ?float $cachedAt = null;

    public function __construct(
        private readonly CacheFactory $cache,
        private readonly ConfigRepository $config,
    ) {
        //
    }

    /**
     * @return array{available: bool, driver: string, latency_ms: float}
     */
    public function check(bool $force = false): array
    {
        $enabled = (bool) $this->config->get('cache.health_check_enabled', true);
        $interval = max(0, (int) $this->config->get('cache.health_check_interval', 300));
        $store = (string) $this->config->get('cache.default', '');
        $driver = (string) $this->config->get("cache.stores.{$store}.driver", 'unknown');
        $signature = implode('|', [$enabled ? '1' : '0', $interval, $store, $driver]);

        if (! $force && $interval > 0 && static::$cachedStatus !== null && static::$cachedSignature === $signature && static::$cachedAt !== null) {
            if ((microtime(true) - static::$cachedAt) < $interval) {
                return static::$cachedStatus;
            }
        }

        if (! $enabled) {
            return $this->remember([
                'available' => true,
                'driver' => $driver,
                'latency_ms' => 0.0,
            ], $signature);
        }

        return $this->remember($this->probeStore($store, $driver), $signature);
    }

    /**
     * @return array{available: bool, driver: string, latency_ms: float}
     */
    private function probeStore(string $store, string $driver): array
    {
        $startedAt = microtime(true);
        $cache = null;

        try {
            $cache = $this->cache->store($store !== '' ? $store : null);
            $key = 'cache_health_check:'.(string) Str::uuid();
            $value = (string) Str::uuid();

            $written = $cache->put($key, $value, 10);
            $available = $written !== false && $cache->get($key) === $value;

            return [
                'available' => $available,
                'driver' => $driver,
                'latency_ms' => $this->elapsedMilliseconds($startedAt),
            ];
        } catch (Throwable) {
            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => $this->elapsedMilliseconds($startedAt),
            ];
        } finally {
            if ($cache instanceof CacheRepository && isset($key)) {
                try {
                    $cache->forget($key);
                } catch (Throwable) {
                    //
                }
            }
        }
    }

    /**
     * @param  array{available: bool, driver: string, latency_ms: float}  $status
     * @return array{available: bool, driver: string, latency_ms: float}
     */
    private function remember(array $status, string $signature): array
    {
        static::$cachedStatus = $status;
        static::$cachedSignature = $signature;
        static::$cachedAt = microtime(true);

        return $status;
    }

    private function elapsedMilliseconds(float $startedAt): float
    {
        return round((microtime(true) - $startedAt) * 1000, 2);
    }
}
