<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Throwable;

class CacheHealthCheck
{
    public function check(?string $store = null): array
    {
        $store ??= config('cache.default');
        $driver = config("cache.stores.{$store}.driver", $store);
        $key = 'cache-health:'.uniqid('', true);
        $startedAt = microtime(true);

        try {
            $cache = Cache::store($store);
            $cache->put($key, 'ok', 5);
            $available = $cache->get($key) === 'ok';
            $cache->forget($key);

            return [
                'available' => $available,
                'driver' => $driver,
                'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
            ];
        } catch (Throwable $exception) {
            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
                'error' => $exception->getMessage(),
            ];
        }
    }
}
