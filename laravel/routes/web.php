<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Cache health check route
Route::get('/health/cache', function () {
    $health = app(\App\Services\CacheHealthCheck::class);
    $results = $health->checkAll();

    $allHealthy = true;
    foreach ($results as $status) {
        if (!$status['available']) {
            $allHealthy = false;
            break;
        }
    }

    return response()->json([
        'healthy' => $allHealthy,
        'stores' => $results,
    ], $allHealthy ? 200 : 503);
});
