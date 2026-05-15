<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CacheHealthCheck
{
    public function check(): array
    {
        $driver = config('cache.default', 'file');
        $testKey = '__cache_health_check_' . time();
        $startTime = microtime(true);

        try {
            Cache::put($testKey, 'ok', 60);
            $value = Cache::get($testKey);
            Cache::forget($testKey);

            $latencyMs = round((microtime(true) - $startTime) * 1000, 2);

            return [
                'available' => $value === 'ok',
                'driver' => $driver,
                'latency_ms' => $latencyMs,
            ];
        } catch (\Throwable $e) {
            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => round((microtime(true) - $startTime) * 1000, 2),
                'error' => $e->getMessage(),
            ];
        }
    }
}
