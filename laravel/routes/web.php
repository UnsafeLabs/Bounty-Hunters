<?php

use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:web')->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/debug/rate-limit', function () {
        $request = request();
        $user = $request->user();
        $key = $user ? 'user:'.$user->getAuthIdentifier() : 'ip:'.$request->ip();
        $remaining = RateLimiter::remaining('web:'.$key, 60);

        return response()->json([
            'key' => $key,
            'limit' => 60,
            'remaining' => $remaining,
            'window' => '1 minute',
            'headers' => [
                'x-ratelimit-limit' => '60',
                'x-ratelimit-remaining' => (string) $remaining,
            ],
        ])->withHeaders([
            'X-RateLimit-Limit' => '60',
            'X-RateLimit-Remaining' => (string) $remaining,
        ]);
    })->name('debug.rate-limit');
});
