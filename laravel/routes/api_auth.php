<?php

use App\Http\Controllers\ApiAuthController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/register', [ApiAuthController::class, 'register']);
Route::post('/auth/login', [ApiAuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [ApiAuthController::class, 'me']);
    Route::post('/auth/logout', [ApiAuthController::class, 'logout']);
    Route::post('/auth/logout-all', [ApiAuthController::class, 'logoutAll']);
    Route::post('/auth/refresh', [ApiAuthController::class, 'refreshToken']);
});
