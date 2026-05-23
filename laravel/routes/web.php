<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware(['throttle:web', 'throttle:60,1'])->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit/debug', function (Request $request) {
        $key = (string) ($request->user()?->getAuthIdentifier() ?: $request->ip());

        return response()->json([
            'key' => $key,
            'headers' => [
                'X-RateLimit-Limit' => 60,
                'X-RateLimit-Remaining' => RateLimiter::remaining($key, 60),
                'Retry-After' => RateLimiter::availableIn($key),
            ],
        ]);
    });
});
