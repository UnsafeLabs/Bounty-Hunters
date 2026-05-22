<?php

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Route;

Route::get('/health/cache', function () {
    $healthCheck = new CacheHealthCheck();
    $result = $healthCheck->check();

    if (!$result['available']) {
        return response()->json([
            'status' => 'unhealthy',
            'driver' => $result['driver'],
            'latency_ms' => $result['latency_ms'],
        ], 503);
    }

    return response()->json([
        'status' => 'healthy',
        'driver' => $result['driver'],
        'latency_ms' => $result['latency_ms'],
    ], 200);
});
