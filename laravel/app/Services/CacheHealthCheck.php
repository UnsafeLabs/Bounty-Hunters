<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class CacheHealthCheck
{
    /**
     * @var array<string, array{checked_at_epoch: float, status: array<string, mixed>}>
     */
    private static array $memoized = [];

    /**
     * @return array<string, mixed>
     */
    public function check(?string $storeName = null, bool $force = false): array
    {
        $storeName ??= (string) config('cache.default', 'array');
        $driver = (string) config("cache.stores.{$storeName}.driver", $storeName);

        if (! (bool) config('cache.health_check_enabled', true)) {
            return [
                'available' => true,
                'driver' => $driver,
                'store' => $storeName,
                'latency_ms' => 0.0,
                'cached' => false,
                'checked' => false,
                'message' => 'Cache health checks are disabled.',
            ];
        }

        $interval = max(0, (int) config('cache.health_check_interval', 300));
        $memoKey = "{$storeName}:{$driver}";
        $now = microtime(true);

        if (! $force && $interval > 0 && isset(self::$memoized[$memoKey])) {
            $cached = self::$memoized[$memoKey];

            if (($now - $cached['checked_at_epoch']) < $interval) {
                return array_merge($cached['status'], ['cached' => true]);
            }
        }

        $started = microtime(true);
        $status = [
            'available' => false,
            'driver' => $driver,
            'store' => $storeName,
            'latency_ms' => null,
            'cached' => false,
            'checked' => true,
        ];

        try {
            $repository = Cache::store($storeName);
            $probeKey = 'cache-health-check:'.(string) Str::uuid();
            $probeValue = Str::random(32);

            $repository->put($probeKey, $probeValue, now()->addSeconds(30));

            if ($repository->get($probeKey) !== $probeValue) {
                throw new RuntimeException('Cache probe value could not be read back.');
            }

            $repository->forget($probeKey);

            $status['available'] = true;
        } catch (Throwable $exception) {
            $status['error'] = $exception->getMessage();
        } finally {
            $status['latency_ms'] = round((microtime(true) - $started) * 1000, 2);
        }

        self::$memoized[$memoKey] = [
            'checked_at_epoch' => $now,
            'status' => $status,
        ];

        return $status;
    }

    public static function clearMemoizedResults(): void
    {
        self::$memoized = [];
    }
}
