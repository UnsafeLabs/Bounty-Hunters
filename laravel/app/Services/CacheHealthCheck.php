<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Throwable;

class CacheHealthCheck
{
    public function check(?string $store = null): array
    {
        $storeName = $store ?: config('cache.default');
        $storeConfig = config("cache.stores.{$storeName}", []);
        $driver = $storeConfig['driver'] ?? $storeName;
        $started = hrtime(true);
        $key = 'cache-health-check:'.bin2hex(random_bytes(8));

        try {
            if (! config('cache.health_check_enabled', true)) {
                return $this->result(true, $driver, $started, 'disabled');
            }

            $cache = Cache::store($storeName);
            $cache->put($key, 'ok', config('cache.health_check_interval', 300));
            $available = $cache->get($key) === 'ok';
            $cache->forget($key);

            return $this->result($available, $driver, $started);
        } catch (Throwable $exception) {
            return $this->result(false, $driver, $started, $exception->getMessage());
        }
    }

    private function result(
        bool $available,
        string $driver,
        int $started,
        ?string $message = null,
    ): array {
        $result = [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => round((hrtime(true) - $started) / 1_000_000, 2),
        ];

        if ($message !== null) {
            $result['message'] = $message;
        }

        return $result;
    }
}
