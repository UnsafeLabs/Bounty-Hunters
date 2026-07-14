<?php

use App\Services\CacheHealthCheck;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/health/cache', function (Request $request, CacheHealthCheck $healthCheck) {
    $result = $healthCheck->check();

    return response()->json($result, $result['available'] ? 200 : 503);
});
