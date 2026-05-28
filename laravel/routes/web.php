<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\RateLimiter;

Route::get('/', function () {
    return view('welcome');
})->middleware('throttle:web');

// Rate limit debug route - shows current rate limit headers
Route::get('/debug/rate-limit', function () {
    $limiter = RateLimiter::availableKeys();
    $attempts = [];

    foreach ($limiter as $key) {
        $attempts[$key] = [
            'remaining' => RateLimiter::remaining($key, 60),
            'reset_at' => RateLimiter::resetAt($key),
        ];
    }

    return response()->json([
        'message' => 'Rate limit status',
        'limiters' => [
            'web' => [
                'max_attempts' => 60,
                'decay_minutes' => 1,
                'distinguishes_authenticated' => true,
            ],
            'api' => [
                'max_attempts' => 60,
                'decay_minutes' => 1,
                'guest_limit' => 30,
            ],
            'auth' => [
                'max_attempts' => 5,
                'decay_minutes' => 1,
            ],
        ],
        'active_limits' => $attempts,
        'headers' => [
            'X-RateLimit-Limit' => request()->header('X-RateLimit-Limit'),
            'X-RateLimit-Remaining' => request()->header('X-RateLimit-Remaining'),
            'X-RateLimit-Reset' => request()->header('X-RateLimit-Reset'),
        ],
    ]);
})->middleware('throttle:web');
