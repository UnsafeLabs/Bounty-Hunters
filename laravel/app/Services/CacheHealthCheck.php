<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;

class CacheHealthCheck
{
    /**
     * Test the connection for the active cache store and return status results.
     *
     * @return array{available: bool, driver: string, latency_ms: float}
     */
    public function check(): array
    {
        $store = Config::get('cache.default');
        $driver = Config::get("cache.stores.{$store}.driver", $store);
        $start = microtime(true);
        $available = false;
        $testKey = '_health_check_' . uniqid('', true);
        $testValue = true;

        try {
            Cache::put($testKey, $testValue, 10);
            $available = Cache::get($testKey) === $testValue;
        } catch (\Exception $e) {
            Log::error('Cache health check failed for driver [' . $driver . ']: ' . $e->getMessage());
        } finally {
            try {
                Cache::forget($testKey);
            } catch (\Exception $e) {
                // Ignore cleanup errors — do not mask the original failure
            }
        }

        $latency = round((microtime(true) - $start) * 1000, 2);

        return [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => $latency,
        ];
    }
}

