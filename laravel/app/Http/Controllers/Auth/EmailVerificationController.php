<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\URL;

class EmailVerificationController extends Controller
{
    public function verify(Request $request, $id, $hash)
    {
        $user = \App\Models\User::findOrFail($id);

        if (! hash_equals((string) $hash, sha1($user->getEmailForVerification()))) {
            abort(403, "Invalid verification link");
        }

        if ($user->hasVerifiedEmail()) {
            return redirect()->route("verification.notice")
                ->with("message", "Email already verified.");
        }

        $user->markEmailAsVerified();

        return redirect("/")->with("message", "Email verified successfully!");
    }

    public function resend(Request $request)
    {
        $user = Auth::user();
        if (! $user) {
            return redirect()->route("login");
        }

        if ($user->hasVerifiedEmail()) {
            return redirect("/")->with("message", "Email already verified.");
        }

        $user->notify(new CustomVerifyEmail);

        return back()->with("message", "Verification email sent!");
    }
}
