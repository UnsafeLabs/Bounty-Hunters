<?php

namespace App\Providers;

use App\Support\WebRateLimit;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

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
        RateLimiter::for(WebRateLimit::LIMITER, function (Request $request) {
            return Limit::perMinute(WebRateLimit::MAX_ATTEMPTS)
                ->by(WebRateLimit::key($request));
        });

        $this->configureSessionFallback();
    }

    private function configureSessionFallback(): void
    {
        $driver = config('session.driver');
        $fallback = config('session.fallback', 'file');

        if ($driver === $fallback || $this->sessionDriverAvailable($driver)) {
            return;
        }

        config(['session.driver' => $fallback]);
    }

    private function sessionDriverAvailable(?string $driver): bool
    {
        return match ($driver) {
            'array', 'cookie', 'file' => true,
            'database' => $this->databaseSessionConnectionAvailable(),
            'dynamodb', 'memcached', 'redis' => $this->cacheSessionStoreAvailable(),
            default => false,
        };
    }

    private function databaseSessionConnectionAvailable(): bool
    {
        $connection = config('session.connection') ?: config('database.default');

        return is_string($connection) && config("database.connections.{$connection}") !== null;
    }

    private function cacheSessionStoreAvailable(): bool
    {
        $store = config('session.store') ?: config('cache.default');

        return is_string($store) && config("cache.stores.{$store}") !== null;
    }
}
