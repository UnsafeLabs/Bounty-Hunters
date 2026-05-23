<?php

use App\Http\Controllers\HealthController;
use Illuminate\Support\Facades\Route;

Route::get('/health/database', [HealthController::class, 'database']);

Route::get('/', function () {
    return view('welcome');
});
