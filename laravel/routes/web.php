<?php

use Illuminate\Http\Request;
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
            'headers' => [
                'x-ratelimit-limit' => $request->headers->get('x-ratelimit-limit'),
                'x-ratelimit-remaining' => $request->headers->get('x-ratelimit-remaining'),
                'retry-after' => $request->headers->get('retry-after'),
            ],
        ]);
    })->name('rate-limit.headers');
});
