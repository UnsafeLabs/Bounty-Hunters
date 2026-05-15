<?php

use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::middleware('throttle:api')->get('/rate-limit-status', function () {
    $key = 'rate-limit-status:'.request()->ip();
    $maxAttempts = (int) config('app.api_rate_limit', 60);

    return response()->json([
        'max_attempts' => $maxAttempts,
        'remaining' => RateLimiter::remaining($key, $maxAttempts),
        'retry_after' => RateLimiter::availableIn($key),
    ]);
});
