<?php

namespace App\Support;

use Illuminate\Http\Request;

final class WebRateLimit
{
    public const MAX_ATTEMPTS = 60;

    public const LIMITER = 'web';

    public static function key(Request $request): string
    {
        $userId = $request->user()?->getAuthIdentifier();

        if ($userId !== null) {
            return 'web:user:'.$userId;
        }

        return 'web:ip:'.$request->ip();
    }

    public static function storageKey(Request $request): string
    {
        return md5(self::LIMITER.self::key($request));
    }

    /**
     * @return array{type: string, value: string}
     */
    public static function source(Request $request): array
    {
        $userId = $request->user()?->getAuthIdentifier();

        if ($userId !== null) {
            return ['type' => 'user', 'value' => (string) $userId];
        }

        return ['type' => 'ip', 'value' => (string) $request->ip()];
    }
}
