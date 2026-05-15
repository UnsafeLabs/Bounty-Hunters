<?php

use App\Http\Controllers\FileController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::prefix('files')->group(function () {
    Route::post('/upload', [FileController::class, 'upload']);
    Route::get('/{id}/download', [FileController::class, 'download']);
    Route::delete('/{id}', [FileController::class, 'destroy']);
    Route::get('/', [FileController::class, 'index']);
});

Route::prefix('webhooks')->group(function () {
    Route::get('/', [WebhookController::class, 'index']);
    Route::post('/', [WebhookController::class, 'store']);
    Route::get('/{id}', [WebhookController::class, 'show']);
    Route::put('/{id}', [WebhookController::class, 'update']);
    Route::delete('/{id}', [WebhookController::class, 'destroy']);
    Route::post('/{id}/test', [WebhookController::class, 'test']);
});
