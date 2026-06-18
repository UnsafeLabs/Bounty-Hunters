<?php

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/health/cache', function (CacheHealthCheck $healthCheck) {
    $result = $healthCheck->check();

    return response()->json($result, $result['available'] ? 200 : 503);
});
