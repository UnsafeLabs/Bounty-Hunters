<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Manager;

class CacheHealthCheck
{
    /**
     * Test the connection for the active cache store.
     *
     * @return array{available: bool, driver: string, latency_ms: float|null, error?: string}
     */
    public function check(): array
    {
        $driver = config('cache.default', 'unknown');
        $result = [
            'available' => false,
            'driver' => $driver,
            'latency_ms' => null,
        ];

        try {
            $start = microtime(true);

            // Try a simple cache operation to test connectivity
            $testKey = 'health_check_' . uniqid();
            Cache::put($testKey, 'healthy', 60);
            $retrieved = Cache::get($testKey);
            Cache::forget($testKey);

            $latency = (microtime(true) - $start) * 1000;

            if ($retrieved === 'healthy') {
                $result['available'] = true;
                $result['latency_ms'] = round($latency, 2);
            } else {
                $result['error'] = 'Cache read/write returned unexpected value';
            }
        } catch (\Exception $e) {
            $result['error'] = $e->getMessage();
        }

        return $result;
    }

    /**
     * Check all configured cache stores.
     *
     * @return array<string, array{available: bool, driver: string, latency_ms: float|null, error?: string}>
     */
    public function checkAll(): array
    {
        $stores = config('cache.stores', []);
        $results = [];

        foreach (array_keys($stores) as $store) {
            $original = config('cache.default');
            config(['cache.default' => $store]);

            $results[$store] = $this->check();

            config(['cache.default' => $original]);
        }

        return $results;
    }
}
