<?php

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::post('/files/upload', [FileController::class, 'upload']);
Route::get('/files', [FileController::class, 'index']);
Route::get('/files/{id}/download', [FileController::class, 'download']);
Route::delete('/files/{id}', [FileController::class, 'destroy']);
