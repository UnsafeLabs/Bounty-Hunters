<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Throwable;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('web', function (Request $request) {
            return Limit::perMinute(60)->by(
                (string) ($request->user()?->getAuthIdentifier() ?: $request->ip())
            );
        });

        $this->configureSessionFallback();
    }

    private function configureSessionFallback(): void
    {
        $driver = config('session.driver');
        $fallback = config('session.fallback', 'file');

        if ($driver === $fallback || $driver === 'file') {
            return;
        }

        if (! $this->sessionDriverIsAvailable($driver)) {
            config(['session.driver' => $fallback]);
        }
    }

    private function sessionDriverIsAvailable(?string $driver): bool
    {
        try {
            return match ($driver) {
                'database' => $this->databaseSessionDriverIsAvailable(),
                'redis' => ! empty(config('database.redis.default')),
                'memcached' => class_exists('Memcached'),
                'dynamodb' => class_exists('Aws\DynamoDb\DynamoDbClient'),
                default => true,
            };
        } catch (Throwable) {
            return false;
        }
    }

    private function databaseSessionDriverIsAvailable(): bool
    {
        $connection = config('session.connection');

        DB::connection($connection)->getPdo();

        return Schema::connection($connection)->hasTable(config('session.table'));
    }
}
