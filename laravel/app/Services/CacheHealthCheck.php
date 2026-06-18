<?php

namespace App\Services;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Throwable;

class CacheHealthCheck
{
    private ?array $lastResult = null;

    private ?float $lastCheckedAt = null;

    public function __construct(private readonly CacheFactory $cache) {}

    /**
     * @return array{available: bool, driver: string, latency_ms: float, store: string, checked_at: string, skipped?: bool, message?: string}
     */
    public function check(bool $force = false): array
    {
        $store = $this->storeName();
        $driver = $this->driverFor($store);

        if (! (bool) config('cache.health_check_enabled', true)) {
            return $this->remember([
                'available' => true,
                'driver' => $driver,
                'latency_ms' => 0.0,
                'store' => $store,
                'checked_at' => now()->toIso8601String(),
                'skipped' => true,
                'message' => 'Cache health checks are disabled.',
            ]);
        }

        $now = microtime(true);
        $interval = max(0, (int) config('cache.health_check_interval', 300));

        if (! $force && $interval > 0 && $this->lastResult !== null && $this->lastCheckedAt !== null) {
            if (($now - $this->lastCheckedAt) < $interval) {
                return $this->lastResult;
            }
        }

        $startedAt = hrtime(true);

        try {
            $repository = $this->cache->store($store);
            $key = sprintf('cache-health:%s:%s', $store, bin2hex(random_bytes(8)));
            $value = bin2hex(random_bytes(16));

            $repository->put($key, $value, 30);
            $storedValue = $repository->get($key);
            $repository->forget($key);

            if ($storedValue !== $value) {
                return $this->remember($this->result(
                    false,
                    $driver,
                    $store,
                    $startedAt,
                    'Cache round-trip validation failed.'
                ));
            }

            return $this->remember($this->result(true, $driver, $store, $startedAt));
        } catch (Throwable $throwable) {
            return $this->remember($this->result(
                false,
                $driver,
                $store,
                $startedAt,
                $throwable->getMessage()
            ));
        }
    }

    private function remember(array $result): array
    {
        $this->lastResult = $result;
        $this->lastCheckedAt = microtime(true);

        return $result;
    }

    /**
     * @return array{available: bool, driver: string, latency_ms: float, store: string, checked_at: string, message?: string}
     */
    private function result(bool $available, string $driver, string $store, int $startedAt, ?string $message = null): array
    {
        $result = [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => round((hrtime(true) - $startedAt) / 1_000_000, 2),
            'store' => $store,
            'checked_at' => now()->toIso8601String(),
        ];

        if ($message !== null) {
            $result['message'] = $message;
        }

        return $result;
    }

    private function storeName(): string
    {
        return (string) config('cache.default', 'array');
    }

    private function driverFor(string $store): string
    {
        $driver = config("cache.stores.{$store}.driver");

        return is_string($driver) && $driver !== '' ? $driver : 'unknown';
    }
}
