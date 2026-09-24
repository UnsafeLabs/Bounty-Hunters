<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Probes the active cache store and reports whether it is reachable.
 *
 * The probe writes a short-lived sentinel key, reads it back and removes it.
 * Results are memoized in the instance for `cache.health_check_interval`
 * seconds so that repeated calls within a single request/process do not
 * hammer the store; pass `$force = true` to bypass the memoization.
 */
class CacheHealthCheck
{
    /**
     * Result of the most recent probe.
     *
     * @var array<string, mixed>|null
     */
    protected ?array $lastResult = null;

    /**
     * Unix timestamp (with microseconds) of the most recent probe.
     */
    protected ?float $lastCheckedAt = null;

    /**
     * @param  string|null  $store  Store name to probe; defaults to `cache.default`.
     * @param  int|null  $interval  Memoization window in seconds; defaults to `cache.health_check_interval`.
     */
    public function __construct(
        protected ?string $store = null,
        protected ?int $interval = null,
    ) {
    }

    /**
     * Whether health checks are enabled via configuration.
     */
    public function isEnabled(): bool
    {
        return (bool) config('cache.health_check_enabled', true);
    }

    /**
     * Probe the cache store.
     *
     * @return array{available: bool, driver: string, latency_ms: float|null, checked_at: string, cached: bool}
     */
    public function check(bool $force = false): array
    {
        $interval = $this->interval ?? (int) config('cache.health_check_interval', 300);

        if (! $force
            && $this->lastResult !== null
            && $this->lastCheckedAt !== null
            && $interval > 0
            && (microtime(true) - $this->lastCheckedAt) < $interval) {
            return $this->lastResult + ['cached' => true];
        }

        $driver = $this->store ?? (string) config('cache.default');
        $start = microtime(true);
        $available = false;

        try {
            $repository = Cache::store($driver);
            $key = 'cache-health-'.bin2hex(random_bytes(4));

            $repository->put($key, 'ok', 5);
            $available = $repository->get($key) === 'ok';
            $repository->forget($key);
        } catch (Throwable) {
            $available = false;
        }

        $this->lastResult = [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => $available ? round((microtime(true) - $start) * 1000, 2) : null,
            'checked_at' => now()->toIso8601String(),
        ];
        $this->lastCheckedAt = microtime(true);

        return $this->lastResult + ['cached' => false];
    }
}
