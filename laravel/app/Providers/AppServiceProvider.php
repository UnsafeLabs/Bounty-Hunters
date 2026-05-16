<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\RateLimiter;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->configureSessionFallback();
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('web', function (Request $request) {
            return Limit::perMinute(60)->by($this->rateLimitKey($request));
        });
    }

    protected function configureSessionFallback(): void
    {
        $driver = config('session.driver');

        if (! is_string($driver) || $this->sessionDriverIsAvailable($driver)) {
            return;
        }

        config(['session.driver' => config('session.fallback', 'file')]);
    }

    protected function sessionDriverIsAvailable(string $driver): bool
    {
        return match ($driver) {
            'array', 'cookie', 'file' => true,
            'database' => $this->configuredDatabaseSessionStoreExists(),
            'dynamodb', 'memcached', 'redis' => $this->configuredCacheStoreExists(),
            default => false,
        };
    }

    protected function configuredDatabaseSessionStoreExists(): bool
    {
        $connection = config('session.connection') ?: config('database.default');
        $connections = config('database.connections', []);

        return is_string($connection)
            && array_key_exists($connection, is_array($connections) ? $connections : [])
            && filled(config('session.table'));
    }

    protected function configuredCacheStoreExists(): bool
    {
        $store = config('session.store') ?: config('cache.default');
        $stores = config('cache.stores', []);

        return is_string($store)
            && array_key_exists($store, is_array($stores) ? $stores : []);
    }

    protected function rateLimitKey(Request $request): string
    {
        return 'web:'.($request->user()?->getAuthIdentifier() ?: $request->ip());
    }
}
