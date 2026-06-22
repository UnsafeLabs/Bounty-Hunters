<?php

use Illuminate\Support\Facades\Route;

Route::middleware('throttle:60,1')->group(function () {
    Route::get('/', function () {
    return view('welcome');
});
});

Route::get('/rate-limit-debug', function (\Illuminate\Http\Request $request) {
    return response()->json([
        'path' => $request->path(),
        'method' => $request->method(),
        'ip' => $request->ip(),
    ]);
})->middleware('throttle:60,1');
