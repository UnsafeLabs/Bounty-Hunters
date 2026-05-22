<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class CacheHealthCheck
{
    /**
     * The cache store being used.
     *
     * @var string
     */
    protected string $store;

    /**
     * Create a new CacheHealthCheck instance.
     */
    public function __construct()
    {
        $this->store = config('cache.default', 'database');
    }

    /**
     * Run the health check for the active cache store.
     *
     * @return array
     */
    public function check(): array
    {
        $driver = $this->getDriverName();
        $startTime = microtime(true);
        $available = false;

        try {
            $available = $this->testConnection();
        } catch (\Exception $e) {
            Log::warning('Cache health check failed', [
                'driver' => $driver,
                'error' => $e->getMessage(),
            ]);
        }

        $latencyMs = round((microtime(true) - $startTime) * 1000, 2);

        return [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => $latencyMs,
        ];
    }

    /**
     * Get the human-readable driver name.
     *
     * @return string
     */
    protected function getDriverName(): string
    {
        return $this->store;
    }

    /**
     * Test the connection for the active cache store.
     *
     * @return bool
     */
    protected function testConnection(): bool
    {
        $storeConfig = config("cache.stores.{$this->store}", []);
        $driver = $storeConfig['driver'] ?? $this->store;

        switch ($driver) {
            case 'file':
            case 'array':
                // File and array drivers are always available locally
                Cache::store($this->store)->put('health_check', time(), 10);
                return Cache::store($this->store)->get('health_check') !== null;

            case 'database':
                DB::connection($storeConfig['connection'] ?? null)->getPdo();
                Cache::store($this->store)->put('health_check', time(), 10);
                return Cache::store($this->store)->get('health_check') !== null;

            case 'redis':
                Redis::connection($storeConfig['connection'] ?? 'default')->ping();
                Cache::store($this->store)->put('health_check', time(), 10);
                return Cache::store($this->store)->get('health_check') !== null;

            case 'memcached':
                Cache::store($this->store)->put('health_check', time(), 10);
                return Cache::store($this->store)->get('health_check') !== null;

            default:
                // For other drivers, attempt a basic put/get operation
                Cache::store($this->store)->put('health_check', time(), 10);
                return Cache::store($this->store)->get('health_check') !== null;
        }
    }
}