<?php

use App\Http\Controllers\CacheHealthController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\NotificationPreferenceController;
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

Route::prefix('notifications')->group(function () {
    Route::get('/preferences', [NotificationPreferenceController::class, 'index']);
    Route::put('/preferences/{id}', [NotificationPreferenceController::class, 'update']);
    Route::post('/preferences/bulk', [NotificationPreferenceController::class, 'bulkUpdate']);
});

Route::get('/health/cache', [CacheHealthController::class, 'show']);
