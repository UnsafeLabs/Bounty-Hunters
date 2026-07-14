<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::prefix('api/webhooks')->group(function () {
    Route::get('/', [WebhookController::class, 'index']);
    Route::post('/', [WebhookController::class, 'store']);
    Route::get('/{webhook}', [WebhookController::class, 'show']);
    Route::put('/{webhook}', [WebhookController::class, 'update']);
    Route::delete('/{webhook}', [WebhookController::class, 'destroy']);
});
