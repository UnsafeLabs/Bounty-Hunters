<?php

namespace App\Providers;

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
        $configuredDriver = config('session.driver');
        $fallbackDriver = config('session.fallback', 'file');

        if (! in_array($configuredDriver, $this->supportedSessionDrivers(), true)) {
            config(['session.driver' => $fallbackDriver]);
        }
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('web', function (Request $request) {
            return Limit::perMinute(60)->by(
                $request->user()?->getAuthIdentifier() ?: $request->ip()
            );
        });
    }

    /**
     * @return array<int, string>
     */
    private function supportedSessionDrivers(): array
    {
        return ['file', 'cookie', 'database', 'apc', 'memcached', 'redis', 'dynamodb', 'array'];
    }
}
