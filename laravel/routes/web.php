<?php

use App\Http\Controllers\FileController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::post('/files/upload', [FileController::class, 'upload'])->name('files.upload');
Route::get('/files', [FileController::class, 'index'])->name('files.index');
Route::get('/files/{file}/download', [FileController::class, 'download'])->name('files.download');
Route::delete('/files/{file}', [FileController::class, 'destroy'])->name('files.destroy');
