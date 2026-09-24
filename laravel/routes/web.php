<?php

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/health/cache', function (CacheHealthCheck $health) {
    if (! $health->isEnabled()) {
        return response()->json(['enabled' => false, 'available' => true]);
    }

    $result = $health->check();

    return response()->json($result, $result['available'] ? 200 : 503);
})->name('health.cache');
