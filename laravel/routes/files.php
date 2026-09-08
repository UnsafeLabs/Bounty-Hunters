<?php

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

// File upload routes
Route::prefix('files')->group(function () {
    Route::post('/upload', [FileController::class, 'upload'])->name('files.upload');
    Route::get('/{id}/download', [FileController::class, 'download'])->name('files.download');
    Route::delete('/{id}', [FileController::class, 'delete'])->name('files.delete');
    Route::get('/', [FileController::class, 'list'])->name('files.list');
});
