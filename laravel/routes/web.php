<?php

use App\Http\Controllers\NotificationPreferenceController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::middleware('auth')->group(function (): void {
    Route::get('/notifications/preferences', [NotificationPreferenceController::class, 'index']);
    Route::put('/notifications/preferences/{preference}', [NotificationPreferenceController::class, 'update']);
    Route::post('/notifications/preferences/bulk', [NotificationPreferenceController::class, 'bulkUpdate']);
});
