<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Include file upload routes
require __DIR__ . '/files.php';
