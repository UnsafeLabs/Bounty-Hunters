<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:web')->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit-status', function (Request $request) {
        $maxAttempts = 60;
        $userId = $request->user()?->getAuthIdentifier();
        $key = $userId ? 'user:'.$userId : 'ip:'.$request->ip();

        return response()->json([
            'limit' => $maxAttempts,
            'remaining' => RateLimiter::remaining($key, $maxAttempts),
            'retry_after' => RateLimiter::availableIn($key),
        ])->withHeaders([
            'X-RateLimit-Limit' => $maxAttempts,
            'X-RateLimit-Remaining' => RateLimiter::remaining($key, $maxAttempts),
            'Retry-After' => RateLimiter::availableIn($key),
        ]);
    });
});
