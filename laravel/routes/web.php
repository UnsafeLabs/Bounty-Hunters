<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:60,1')->group(function () {
    Route::get('/', function () {
        return view('welcome');
    });

    Route::get('/rate-limit-debug', function (Request $request) {
        return response()->json([
            'X-RateLimit-Limit'     => $request->headers->get('X-RateLimit-Limit'),
            'X-RateLimit-Remaining' => $request->headers->get('X-RateLimit-Remaining'),
            'X-RateLimit-Reset'     => $request->headers->get('X-RateLimit-Reset'),
            'ip'                    => $request->ip(),
            'user_id'               => auth()->id(),
        ]);
    })->name('rate-limit.debug');
});
