<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\HealthCheckController;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/api/health/database', [HealthCheckController::class, 'database']);

Route::post('/api/register', [AuthController::class, 'register']);
Route::post('/api/login', [AuthController::class, 'login']);
Route::post('/api/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
