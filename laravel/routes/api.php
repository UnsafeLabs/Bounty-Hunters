<?php

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

Route::prefix('files')->group(function () {
    Route::post('/upload', [FileController::class, 'upload']);
    Route::get('/{id}/download', [FileController::class, 'download']);
    Route::delete('/{id}', [FileController::class, 'destroy']);
    Route::get('/', [FileController::class, 'index']);
});
