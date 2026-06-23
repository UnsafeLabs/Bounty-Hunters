<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureEmailIsVerified
{
    /**
     * Ensure the authenticated user has a verified email address.
     *
     * Unverified users are redirected to the verification notice route
     * (JSON clients receive a 409 instead so they are not redirected).
     */
    public function handle(Request $request, Closure $next, ?string $redirectToRoute = null): Response
    {
        if (! $request->user() ||
            ($request->user() instanceof MustVerifyEmail &&
             ! $request->user()->hasVerifiedEmail())) {
            return $request->expectsJson()
                ? response()->json(['message' => 'Your email address is not verified.'], 409)
                : redirect()->route($redirectToRoute ?: 'verification.notice');
        }

        return $next($request);
    }
}
