<?php

use App\Http\Controllers\NotificationPreferenceController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth')->group(function (): void {
    Route::get('/notifications/preferences', [NotificationPreferenceController::class, 'index']);
    Route::put('/notifications/preferences/{notificationPreference}', [NotificationPreferenceController::class, 'update']);
    Route::post('/notifications/preferences/bulk', [NotificationPreferenceController::class, 'bulkUpdate']);
});
