<?php

namespace App\Services;

use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Cache;
use Throwable;

class CacheHealthCheck
{
    /**
     * @return array{available: bool, driver: string, latency_ms: float, error?: string, message?: string}
     */
    public function check(): array
    {
        $driver = (string) config('cache.default', 'array');

        if (! config('cache.health_check_enabled', true)) {
            return [
                'available' => true,
                'driver' => $driver,
                'latency_ms' => 0.0,
                'message' => 'disabled',
            ];
        }

        $start = microtime(true);

        try {
            $store = Cache::store($driver);
            $this->probe($store);

            return [
                'available' => true,
                'driver' => $driver,
                'latency_ms' => $this->latencySince($start),
            ];
        } catch (Throwable $exception) {
            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => $this->latencySince($start),
                'error' => $exception->getMessage(),
            ];
        }
    }

    protected function probe(Repository $store): void
    {
        $key = 'cache-health-check:'.bin2hex(random_bytes(8));
        $value = bin2hex(random_bytes(8));

        $store->put($key, $value, now()->addSeconds(
            (int) config('cache.health_check_interval', 300)
        ));

        if ($store->get($key) !== $value) {
            throw new \RuntimeException('Cache read/write verification failed');
        }

        $store->forget($key);
    }

    protected function latencySince(float $start): float
    {
        return round((microtime(true) - $start) * 1000, 2);
    }
}
