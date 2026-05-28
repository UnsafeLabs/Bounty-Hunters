<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\WebhookController;

Route::get('/', function () {
    return view('welcome');
});

// Webhook management routes
Route::prefix('api/webhooks')->group(function () {
    Route::get('/', [WebhookController::class, 'index']);
    Route::post('/', [WebhookController::class, 'store']);
    Route::get('/{webhook}', [WebhookController::class, 'show']);
    Route::put('/{webhook}', [WebhookController::class, 'update']);
    Route::delete('/{webhook}', [WebhookController::class, 'destroy']);
});

// Incoming webhook endpoint
Route::post('/webhooks/receive/{event}', [WebhookController::class, 'receive']);
