<?php

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/health/cache', function (CacheHealthCheck $healthCheck) {
    $results = $healthCheck->check();
    return response()->json($results, $results['available'] ? 200 : 503);
});
