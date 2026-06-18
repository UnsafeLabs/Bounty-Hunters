<?php

namespace App\Support;

class SessionDriverFallback
{
    public static function fallbackDriver(): string
    {
        return (string) config('session.fallback', 'file');
    }

    public static function resolveDriver(?string $driver = null): string
    {
        $driver = $driver ?? (string) config('session.driver', 'file');

        return $driver !== '' ? $driver : self::fallbackDriver();
    }
}
