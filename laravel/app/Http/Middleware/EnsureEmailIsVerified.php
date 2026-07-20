<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureEmailIsVerified
{
    /**
     * Redirect unverified users to the verification notice page.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            $user instanceof MustVerifyEmail
            && ! $user->hasVerifiedEmail()
        ) {
            return $request->expectsJson()
                ? response()->json(['message' => 'Your email address is not verified.'], 409)
                : redirect()->route('verification.notice');
        }

        return $next($request);
    }
}
