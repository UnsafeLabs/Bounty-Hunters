<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:web')->group(function (): void {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit-headers', function (Request $request) {
        return response()->json([
            'limit' => 60,
            'window_seconds' => 60,
            'key_type' => $request->user() ? 'user' : 'ip',
            'key' => $request->user()?->getAuthIdentifier() ?? $request->ip(),
            'attempts' => RateLimiter::attempts(($request->user()?->getAuthIdentifier() ?? $request->ip()).'|web'),
        ]);
    })->name('rate-limit.headers');
});
