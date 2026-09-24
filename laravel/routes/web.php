<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware(['throttle:web'])->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/debug/rate-limit', function (Request $request) {
        return response()->json([
            'limiter' => 'web',
            'limit' => 60,
            'decay_minutes' => 1,
            'key' => $request->user()?->id ?: $request->ip(),
        ]);
    })->name('debug.rate-limit');
});
