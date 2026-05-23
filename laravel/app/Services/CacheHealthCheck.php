<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CacheHealthCheck
{
    public function check(): array
    {
        $driver = config('cache.default');
        $start = microtime(true);
        try {
            $available = Cache::store($driver)->set('health_check_key', true, 1);
            Cache::store($driver)->forget('health_check_key');
            $latency = (microtime(true) - $start) * 1000;
        } catch (\Exception $e) {
            $available = false;
            $latency = null;
        }
        return [
            'available' => $available,
            'driver' => $driver,
            'latency_ms' => $latency !== null ? round($latency, 2) : null,
        ];
    }

    public function validateActiveStore(): bool
    {
        $result = $this->check();
        if (!$result['available']) {
            $fallback = 'file';
            config(['cache.default' => $fallback]);
            Cache::store($fallback)->set('health_check_fallback', true, 1);
        }
        return $result['available'];
    }
}