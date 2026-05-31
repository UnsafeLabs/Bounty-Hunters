<?php

namespace App\Services;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Config\Repository as ConfigRepository;
use RuntimeException;
use Throwable;

class CacheHealthCheck
{
    private ?array $lastResult = null;

    private ?float $lastCheckedAt = null;

    public function __construct(
        private readonly CacheFactory $cache,
        private readonly ConfigRepository $config,
    ) {}

    /**
     * @return array{available: bool, driver: string, latency_ms: float, store: string, checked: bool, cached: bool, error?: string}
     */
    public function check(bool $force = false): array
    {
        $storeName = (string) $this->config->get('cache.default', 'default');
        $driver = (string) $this->config->get("cache.stores.{$storeName}.driver", $storeName);

        if (! (bool) $this->config->get('cache.health_check_enabled', true)) {
            return [
                'available' => true,
                'driver' => $driver,
                'latency_ms' => 0.0,
                'store' => $storeName,
                'checked' => false,
                'cached' => false,
            ];
        }

        if (! $force && $this->hasFreshCachedResult()) {
            return [
                ...$this->lastResult,
                'cached' => true,
            ];
        }

        $result = $this->probeStore($storeName, $driver);
        $this->lastResult = $result;
        $this->lastCheckedAt = microtime(true);

        return $result;
    }

    private function hasFreshCachedResult(): bool
    {
        if ($this->lastResult === null || $this->lastCheckedAt === null) {
            return false;
        }

        $interval = max(0, (int) $this->config->get('cache.health_check_interval', 300));

        return $interval > 0 && (microtime(true) - $this->lastCheckedAt) < $interval;
    }

    /**
     * @return array{available: bool, driver: string, latency_ms: float, store: string, checked: bool, cached: bool, error?: string}
     */
    private function probeStore(string $storeName, string $driver): array
    {
        $startedAt = hrtime(true);

        try {
            $store = $this->cache->store($storeName);
            $key = 'health:cache:'.bin2hex(random_bytes(8));
            $value = bin2hex(random_bytes(16));

            $store->put($key, $value, 30);

            if ($store->get($key) !== $value) {
                throw new RuntimeException('Cache store did not return the health check value.');
            }

            $store->forget($key);

            return [
                'available' => true,
                'driver' => $driver,
                'latency_ms' => $this->latencySince($startedAt),
                'store' => $storeName,
                'checked' => true,
                'cached' => false,
            ];
        } catch (Throwable $exception) {
            return [
                'available' => false,
                'driver' => $driver,
                'latency_ms' => $this->latencySince($startedAt),
                'store' => $storeName,
                'checked' => true,
                'cached' => false,
                'error' => $exception->getMessage(),
            ];
        }
    }

    private function latencySince(int $startedAt): float
    {
        return round((hrtime(true) - $startedAt) / 1_000_000, 3);
    }
}
