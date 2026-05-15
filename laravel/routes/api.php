<?php

use App\Http\Controllers\FileController;
use App\Http\Controllers\DatabaseHealthController;
use Illuminate\Support\Facades\Route;

Route::prefix('files')->group(function () {
    Route::post('/upload', [FileController::class, 'upload']);
    Route::get('/{id}/download', [FileController::class, 'download']);
    Route::delete('/{id}', [FileController::class, 'destroy']);
    Route::get('/', [FileController::class, 'index']);
});

Route::get('/health/database', [DatabaseHealthController::class, 'show']);
