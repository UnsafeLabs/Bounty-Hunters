<?php

namespace App\Support;

use Illuminate\Http\Request;

class WebRateLimit
{
    public const MAX_ATTEMPTS = 60;

    public static function key(Request $request): string
    {
        $userId = $request->user()?->getAuthIdentifier();

        if ($userId !== null) {
            return 'web|user:'.$userId;
        }

        return 'web|ip:'.$request->ip();
    }
}
