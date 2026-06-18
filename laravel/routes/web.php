<?php

use App\Support\WebRateLimit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:web')->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit/debug', function (Request $request) {
        $key = WebRateLimit::key($request);
        $remaining = RateLimiter::remaining($key, WebRateLimit::MAX_ATTEMPTS);

        return response()
            ->json([
                'key' => $key,
                'limit' => WebRateLimit::MAX_ATTEMPTS,
                'remaining' => $remaining,
                'retry_after' => RateLimiter::availableIn($key),
            ])
            ->withHeaders([
                'X-RateLimit-Limit' => WebRateLimit::MAX_ATTEMPTS,
                'X-RateLimit-Remaining' => $remaining,
            ]);
    });
});
