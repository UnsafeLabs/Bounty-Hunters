<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Contracts\View\View;
use Illuminate\Foundation\Auth\EmailVerificationRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class EmailVerificationController extends Controller
{
    /**
     * Show the email verification notice to an unverified user.
     */
    public function notice(Request $request): View|JsonResponse|RedirectResponse
    {
        if ($request->user()->hasVerifiedEmail()) {
            return $request->expectsJson()
                ? response()->json(['message' => 'Your email address is already verified.'])
                : redirect()->intended('/');
        }

        return $request->expectsJson()
            ? response()->json(['message' => 'Your email address is not verified.'], 409)
            : view('auth.verify-email');
    }

    /**
     * Mark the authenticated user's email address as verified.
     *
     * The signed URL and the `id`/`hash` route parameters are validated by
     * the EmailVerificationRequest before this method runs.
     */
    public function verify(EmailVerificationRequest $request): RedirectResponse
    {
        if ($request->user()->hasVerifiedEmail()) {
            return redirect()->intended('/?verified=1');
        }

        $request->fulfill();

        return redirect()->intended('/?verified=1');
    }

    /**
     * Resend the email verification notification.
     */
    public function send(Request $request): JsonResponse|RedirectResponse
    {
        if ($request->user()->hasVerifiedEmail()) {
            return redirect()->intended('/');
        }

        $request->user()->sendEmailVerificationNotification();

        return response()->json(['message' => 'Verification link sent.']);
    }
}
