<?php

namespace App\Support;

class SessionDriverFallback
{
    /** @var array<int, string> */
    private const LOCAL_DRIVERS = ['array', 'cookie', 'file'];

    public static function apply(): void
    {
        $driver = (string) config('session.driver', 'file');

        if (self::isAvailable($driver)) {
            return;
        }

        config(['session.driver' => self::fallbackDriver()]);
    }

    public static function fallbackDriver(): string
    {
        $fallback = (string) config('session.fallback', 'file');

        if ($fallback !== '' && self::isAvailable($fallback)) {
            return $fallback;
        }

        return 'file';
    }

    public static function isAvailable(string $driver): bool
    {
        if (in_array($driver, self::LOCAL_DRIVERS, true)) {
            return true;
        }

        if ($driver === 'database') {
            $connection = config('session.connection') ?: config('database.default');

            return $connection !== null && config("database.connections.{$connection}") !== null;
        }

        if ($driver === 'redis') {
            $connection = config('session.connection') ?: 'default';

            return config("database.redis.{$connection}") !== null;
        }

        if (in_array($driver, ['dynamodb', 'memcached'], true)) {
            $store = config('session.store') ?: $driver;

            return config("cache.stores.{$store}") !== null;
        }

        return false;
    }
}
