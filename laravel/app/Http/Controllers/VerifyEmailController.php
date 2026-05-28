<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\URL;

class VerifyEmailController extends Controller
{
    /**
     * Mark the authenticated user's email address as verified.
     */
    public function __invoke(Request $request, User $user): JsonResponse|RedirectResponse
    {
        if (! $request->hasValidSignature()) {
            return $this->invalidSignatureResponse();
        }

        if ($user->hasVerifiedEmail()) {
            return $this->alreadyVerifiedResponse();
        }

        if ($user->markEmailAsVerified()) {
            event(new Verified($user));
        }

        return $this->verifiedResponse();
    }

    /**
     * Send a new email verification notification.
     */
    public function resend(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email|exists:users,email',
        ]);

        $user = User::where('email', $request->email)->firstOrFail();

        if ($user->hasVerifiedEmail()) {
            return response()->json([
                'message' => 'Email already verified.',
            ], 200);
        }

        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            ['id' => $user->getKey(), 'hash' => sha1($user->getEmailForVerification())]
        );

        $user->sendEmailVerificationNotification();

        return response()->json([
            'message' => 'Verification email sent.',
            'verification_url' => $verificationUrl,
        ], 200);
    }

    protected function invalidSignatureResponse(): JsonResponse
    {
        return response()->json([
            'error' => 'Invalid verification link.',
        ], 400);
    }

    protected function alreadyVerifiedResponse(): JsonResponse
    {
        return response()->json([
            'message' => 'Email already verified.',
        ], 200);
    }

    protected function verifiedResponse(): JsonResponse
    {
        return response()->json([
            'message' => 'Email verified successfully.',
        ], 200);
    }
}
