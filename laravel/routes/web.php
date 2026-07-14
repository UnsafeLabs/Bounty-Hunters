<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware(['throttle:60,1'])->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });
});

Route::get('/rate-limits', function (Request $request) {
    $remaining = $request->attributes->get('X-RateLimit-Remaining');
    $limit = $request->attributes->get('X-RateLimit-Limit');
    $resetAt = $request->attributes->get('X-RateLimit-Reset');
    return response()->json([
        'remaining' => $remaining,
        'limit' => $limit,
        'reset_at' => $resetAt,
        'ip' => $request->ip(),
    ]);
})->middleware('throttle:60,1');
