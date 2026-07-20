<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Throwable;

class CacheHealthCheck
{
    /**
     * @return array{available: bool, driver: string, latency_ms: float, error?: string}
     */
    public function check(?string $store = null): array
    {
        $driver = (string) ($store
            ? Config::get("cache.stores.{$store}.driver", $store)
            : Config::get('cache.default', 'file'));

        $storeName = $store ?: (string) Config::get('cache.default', 'file');
        $start = hrtime(true);

        try {
            $key = 'cache_health_check_' . bin2hex(random_bytes(8));
            $value = 'ok_' . $start;
            Cache::store($storeName)->put($key, $value, 10);
            $read = Cache::store($storeName)->get($key);
            Cache::store($storeName)->forget($key);

            $latencyMs = (hrtime(true) - $start) / 1e6;
            $available = $read === $value;

            return [
                'available' => $available,
                'driver' => $driver,
                'latency_ms' => round($latencyMs, 3),
                ...($available ? [] : ['error' => 'round-trip mismatch']),
            ];
        } catch (Throwable $e) {
            $latencyMs = (hrtime(true) - $start) / 1e6;

            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => round($latencyMs, 3),
                'error' => $e->getMessage(),
            ];
        }
    }

    public function isEnabled(): bool
    {
        return (bool) Config::get('cache.health_check_enabled', true);
    }

    public function intervalSeconds(): int
    {
        return (int) Config::get('cache.health_check_interval', 300);
    }
}
