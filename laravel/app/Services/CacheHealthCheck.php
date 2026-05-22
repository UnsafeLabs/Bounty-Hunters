<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\DB;
use Exception;

class CacheHealthCheck
{
    /**
     * Perform a health check on the active cache store.
     *
     * @return array{available: bool, driver: string, latency_ms: float}
     */
    public function check(): array
    {
        $driver = config('cache.default');
        $startTime = microtime(true);

        $available = $this->testConnection($driver);

        $latencyMs = round((microtime(true) - $startTime) * 1000, 2);

        return [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => $latencyMs,
        ];
    }

    /**
     * Test the connection for the given cache driver.
     */
    protected function testConnection(string $driver): bool
    {
        $testKey = '__health_check_' . uniqid();
        $testValue = 'ok_' . time();

        try {
            return match ($driver) {
                'file' => $this->testFileStore($testKey, $testValue),
                'redis' => $this->testRedisStore($testKey, $testValue),
                'database' => $this->testDatabaseStore($testKey, $testValue),
                'array' => $this->testArrayStore($testKey, $testValue),
                'memcached' => $this->testMemcachedStore($testKey, $testValue),
                'dynamodb' => $this->testDynamodbStore($testKey, $testValue),
                'octane' => $this->testOctaneStore($testKey, $testValue),
                'failover' => $this->testFailoverStore($testKey, $testValue),
                default => $this->testGenericStore($testKey, $testValue),
            };
        } catch (Exception $e) {
            return false;
        }
    }

    protected function testFileStore(string $key, string $value): bool
    {
        if (!Cache::store('file')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('file')->get($key);
        Cache::store('file')->forget($key);

        return $retrieved === $value;
    }

    protected function testRedisStore(string $key, string $value): bool
    {
        try {
            $connection = config('cache.stores.redis.connection', 'cache');
            Redis::connection($connection)->ping();
        } catch (Exception $e) {
            // Fallback: try via Cache facade
        }

        if (!Cache::store('redis')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('redis')->get($key);
        Cache::store('redis')->forget($key);

        return $retrieved === $value;
    }

    protected function testDatabaseStore(string $key, string $value): bool
    {
        if (!Cache::store('database')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('database')->get($key);
        Cache::store('database')->forget($key);

        return $retrieved === $value;
    }

    protected function testArrayStore(string $key, string $value): bool
    {
        if (!Cache::store('array')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('array')->get($key);
        Cache::store('array')->forget($key);

        return $retrieved === $value;
    }

    protected function testMemcachedStore(string $key, string $value): bool
    {
        if (!Cache::store('memcached')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('memcached')->get($key);
        Cache::store('memcached')->forget($key);

        return $retrieved === $value;
    }

    protected function testDynamodbStore(string $key, string $value): bool
    {
        if (!Cache::store('dynamodb')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('dynamodb')->get($key);
        Cache::store('dynamodb')->forget($key);

        return $retrieved === $value;
    }

    protected function testOctaneStore(string $key, string $value): bool
    {
        if (!Cache::store('octane')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('octane')->get($key);
        Cache::store('octane')->forget($key);

        return $retrieved === $value;
    }

    protected function testFailoverStore(string $key, string $value): bool
    {
        if (!Cache::store('failover')->put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::store('failover')->get($key);
        Cache::store('failover')->forget($key);

        return $retrieved === $value;
    }

    protected function testGenericStore(string $key, string $value): bool
    {
        if (!Cache::put($key, $value, 10)) {
            return false;
        }

        $retrieved = Cache::get($key);
        Cache::forget($key);

        return $retrieved === $value;
    }
}
