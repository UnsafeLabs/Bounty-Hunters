<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', 'throttle:web'])->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/debug/rate-limit', function (Request $request) {
        $userKey = optional($request->user())->id;
        $key = $userKey ?: $request->ip();
        return response()->json([
            'limiter' => 'web',
            'key' => (string) $key,
            'authenticated' => $userKey !== null,
            'max_attempts' => 60,
            'decay_seconds' => 60,
        ])->withHeaders([
            'X-RateLimit-Limit' => '60',
            'X-RateLimit-Policy' => '60;w=60',
        ]);
    });
});
