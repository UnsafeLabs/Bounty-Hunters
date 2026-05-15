<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::apiResource('webhooks', WebhookController::class);
