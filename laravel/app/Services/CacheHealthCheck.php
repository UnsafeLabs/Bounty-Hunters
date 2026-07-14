<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CacheHealthCheck
{
    public function check(?string $store = null): array
    {
        $store = $store ?? config('cache.default', 'file');
        $driver = config("cache.stores.{$store}.driver", 'unknown');

        $start = microtime(true);

        try {
            $key = 'health_check_' . uniqid();
            $value = 'ok_' . now()->toIso8601String();

            Cache::store($store)->put($key, $value, 10);
            $retrieved = Cache::store($store)->get($key);
            Cache::store($store)->forget($key);

            $available = $retrieved === $value;
        } catch (\Throwable $e) {
            $available = false;
        }

        $latencyMs = round((microtime(true) - $start) * 1000, 2);

        return [
            'available' => $available,
            'driver' => $driver,
            'store' => $store,
            'latency_ms' => $latencyMs,
        ];
    }
}
