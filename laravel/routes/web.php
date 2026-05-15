<?php

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/health/cache', function (CacheHealthCheck $healthCheck) {
    if (!Config::get('cache.health_check_enabled', true)) {
        return response()->json(['error' => 'Health check disabled'], 404);
    }

    $results = $healthCheck->check();

    return response()->json($results, $results['available'] ? 200 : 503);
});

