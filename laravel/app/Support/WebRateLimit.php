<?php

namespace App\Support;

use Illuminate\Http\Request;

class WebRateLimit
{
    public const MAX_ATTEMPTS = 60;

    public static function key(Request $request): string
    {
        $user = $request->user();

        if ($user !== null) {
            return 'web:user:'.$user->getAuthIdentifier();
        }

        return 'web:ip:'.$request->ip();
    }
}
