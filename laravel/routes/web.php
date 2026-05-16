<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;

Route::middleware(['throttle:60,1'])->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit-debug', function (Request $request) {
        return response()->json([
            'limit' => $request->attributes->get('ratelimiter-limit', 'N/A'),
            'remaining' => $request->attributes->get('ratelimiter-remaining', 'N/A'),
            'reset' => $request->attributes->get('ratelimiter-reset', 'N/A'),
            'user' => $request->user()?->id ?? 'guest',
        ]);
    });
});