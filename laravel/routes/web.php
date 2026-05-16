<?php

use App\Support\WebRateLimit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware(['throttle:'.WebRateLimit::LIMITER])->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit/debug', function (Request $request) {
        $key = WebRateLimit::storageKey($request);
        $remaining = RateLimiter::remaining($key, WebRateLimit::MAX_ATTEMPTS);
        $retryAfter = RateLimiter::tooManyAttempts($key, WebRateLimit::MAX_ATTEMPTS)
            ? RateLimiter::availableIn($key)
            : 0;

        return response()->json([
            'limit' => WebRateLimit::MAX_ATTEMPTS,
            'remaining' => $remaining,
            'retry_after' => $retryAfter,
            'source' => WebRateLimit::source($request),
        ])->withHeaders([
            'X-RateLimit-Limit' => WebRateLimit::MAX_ATTEMPTS,
            'X-RateLimit-Remaining' => $remaining,
            'Retry-After' => $retryAfter,
        ]);
    });
});
