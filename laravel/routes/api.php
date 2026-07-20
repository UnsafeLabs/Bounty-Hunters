<?php

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

Route::get('/files', [FileController::class, 'index']);
Route::post('/files/upload', [FileController::class, 'upload']);
Route::get('/files/{id}/download', [FileController::class, 'download'])->whereNumber('id');
Route::delete('/files/{id}', [FileController::class, 'destroy'])->whereNumber('id');
