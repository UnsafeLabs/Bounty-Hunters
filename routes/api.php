<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\NotificationPreferenceController;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/notifications/preferences', [NotificationPreferenceController::class, 'index']);
    Route::put('/notifications/preferences/{id}', [NotificationPreferenceController::class, 'update']);
    Route::post('/notifications/preferences/bulk', [NotificationPreferenceController::class, 'bulkUpdate']);
});
