<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;

class CacheHealthCheck
{
    /**
     * Test the connection for the active cache store.
     *
     * @return array{available: bool, driver: string, latency_ms: float}
     */
    public function check(): array
    {
        $driver = Config::get('cache.default');
        $start = microtime(true);
        $available = false;

        try {
            // Attempt a simple store and retrieve
            $key = 'health_check_' . time();
            Cache::put($key, true, 10);
            if (Cache::get($key) === true) {
                Cache::forget($key);
                $available = true;
            }
        } catch (\Exception $e) {
            $available = false;
        }

        $latency = (microtime(true) - $start) * 1000;

        return [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => round($latency, 2),
        ];
    }
}
