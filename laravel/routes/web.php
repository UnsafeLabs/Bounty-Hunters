<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\VerifyEmailController;

Route::get('/', function () {
    return view('welcome');
});

// Email verification routes
Route::prefix('api/auth')->group(function () {
    Route::post('/email/verification-notification', [VerifyEmailController::class, 'resend'])
        ->name('verification.send');
});

Route::get('/email/verify/{user}/{hash}', VerifyEmailController::class)
    ->middleware('signed')
    ->name('verification.verify');
