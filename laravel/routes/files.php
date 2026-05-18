<?php

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/files/upload', [FileController::class, 'upload']);
    Route::get('/files', [FileController::class, 'list']);
    Route::get('/files/{file}/download', [FileController::class, 'download']);
    Route::delete('/files/{file}', [FileController::class, 'delete']);
});
