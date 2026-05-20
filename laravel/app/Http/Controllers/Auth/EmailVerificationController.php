<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Mail;

class EmailVerificationController extends Controller
{
    public function sendVerificationEmail(Request $request)
    {
        $user = $request->user();
        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Email already verified']);
        }

        $token = sha1($user->email . $user->created_at . config('app.key'));
        $user->email_verification_token = $token;
        $user->save();

        Mail::send('emails.verify-email', ['token' => $token, 'user' => $user], function ($m) use ($user) {
            $m->to($user->email)->subject('Verify Email Address');
        });

        return response()->json(['message' => 'Verification email sent']);
    }

    public function verify(Request $request, $token)
    {
        $user = User::where('email_verification_token', $token)->first();
        if (!$user) {
            return response()->json(['message' => 'Invalid token'], 400);
        }

        $user->email_verified_at = now();
        $user->email_verification_token = null;
        $user->save();

        return response()->json(['message' => 'Email verified successfully']);
    }
}
