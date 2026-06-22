<?php

use Illuminate\Support\Facades\Route;

Route::get("/", function () {
    return view("welcome");
});

Route::middleware("guest")->group(function () {
    Route::get("/email/verify", function () {
        return view("auth.verify-email");
    })->name("verification.notice");

    Route::post("/email/verification-notification", [\App\Http\Controllers\Auth\EmailVerificationController::class, "resend"])
        ->middleware(["throttle:1,1"])
        ->name("verification.send");

    Route::get("/email/verify/{id}/{hash}", [\App\Http\Controllers\Auth\EmailVerificationController::class, "verify"])
        ->middleware(["signed"])
        ->name("verification.verify");
});
