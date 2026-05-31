<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::apiResource('webhooks', WebhookController::class)
    ->only(['index', 'store', 'show', 'update', 'destroy']);
