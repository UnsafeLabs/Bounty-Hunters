<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/webhooks', [WebhookController::class, 'index']);
    Route::post('/webhooks', [WebhookController::class, 'store']);
    Route::put('/webhooks/{webhook}', [WebhookController::class, 'update']);
    Route::delete('/webhooks/{webhook}', [WebhookController::class, 'destroy']);
    Route::get('/webhooks/{webhook}/deliveries', [WebhookController::class, 'deliveries']);
});
