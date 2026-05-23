<?php

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Route;

Route::get('/health/cache', function (CacheHealthCheck $healthCheck) {
    $status = $healthCheck->check();

    return response()->json($status, $status['available'] ? 200 : 503);
});

Route::get('/', function () {
    return view('welcome');
});
