<?php
use Illuminate\Support\Facades\Route;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
RateLimiter::for('api', function (Request $request) { return Limit::perMinute(60)->by(optional($request->user())->id ?: $request->ip()); });
Route::middleware(['throttle:api'])->group(function () { Route::get('/api/users', [App\Http\Controllers\UserController::class, 'index']); Route::post('/api/users', [App\Http\Controllers\UserController::class, 'store']); });
Route::get('/rate-limit-debug', function (Request $request) { $key = optional($request->user())->id ?: $request->ip(); return response()->json(['key'=>$key, 'attempts'=>RateLimiter::attempts($key.'|api'), 'available_in'=>RateLimiter::availableIn($key.'|api')]); })->middleware('throttle:10,1');