<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Throwable;

class CacheHealthCheck
{
    /**
     * @return array{available: bool, driver: string, latency_ms: float, enabled: bool, interval: int, error?: string}
     */
    public function check(): array
    {
        $enabled = (bool) config('cache.health_check_enabled', true);
        $interval = (int) config('cache.health_check_interval', 300);
        $storeName = (string) config('cache.default');
        $driver = (string) config("cache.stores.{$storeName}.driver", $storeName);

        if (! $enabled) {
            return [
                'available' => true,
                'driver' => $driver,
                'latency_ms' => 0.0,
                'enabled' => false,
                'interval' => $interval,
            ];
        }

        $key = 'cache-health-check:'.bin2hex(random_bytes(8));
        $value = bin2hex(random_bytes(16));
        $started = hrtime(true);

        try {
            $store = Cache::store($storeName);
            $store->put($key, $value, $interval);
            $available = $store->get($key) === $value;
            $store->forget($key);

            return [
                'available' => $available,
                'driver' => $driver,
                'latency_ms' => $this->latencyMs($started),
                'enabled' => true,
                'interval' => $interval,
            ];
        } catch (Throwable $exception) {
            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => $this->latencyMs($started),
                'enabled' => true,
                'interval' => $interval,
                'error' => $exception->getMessage(),
            ];
        }
    }

    private function latencyMs(int $started): float
    {
        return round((hrtime(true) - $started) / 1_000_000, 2);
    }
}
