<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:web')->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit/debug', function (Request $request) {
        $key = 'web:'.($request->user()?->getAuthIdentifier() ?: $request->ip());
        $remaining = RateLimiter::remaining($key, 60);

        return response()->json([
            'limit' => 60,
            'remaining' => $remaining,
            'retry_after' => RateLimiter::availableIn($key),
            'key' => $key,
        ])->withHeaders([
            'X-RateLimit-Limit' => '60',
            'X-RateLimit-Remaining' => (string) $remaining,
        ]);
    });
});
