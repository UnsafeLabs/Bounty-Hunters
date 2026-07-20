<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Route;

Route::get('/health/cache', function (CacheHealthCheck $health) {
    if (! $health->isEnabled()) {
        return response()->json([
            'available' => true,
            'driver' => 'disabled',
            'latency_ms' => 0,
            'message' => 'health check disabled',
        ], 200);
    }
    $result = $health->check();
    $status = $result['available'] ? 200 : 503;

    return response()->json($result, $status);
});
