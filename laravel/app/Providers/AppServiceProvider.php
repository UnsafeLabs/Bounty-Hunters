<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->registerRateLimiter();
        $this->configureSessionFallback();
    }

    protected function registerRateLimiter(): void
    {
        RateLimiter::for('web', function (Request $request) {
            return Limit::perMinute(60)->by(
                optional($request->user())->id ?: $request->ip()
            );
        });
    }

    protected function configureSessionFallback(): void
    {
        $driver   = config('session.driver');
        $fallback = config('session.fallback', 'file');

        if ($driver === $fallback) {
            return;
        }

        if (! in_array($driver, ['database', 'redis', 'memcached', 'dynamodb'], true)) {
            return;
        }

        try {
            match ($driver) {
                'database' => \DB::connection(
                    config('session.connection')
                )->getPdo(),
                'redis' => \Redis::connection(
                    config('session.store') ?: 'default'
                )->ping(),
                default => \Cache::store(
                    config('session.store') ?: $driver
                )->get('__session_health_check__'),
            };
        } catch (\Throwable $e) {
            config(['session.driver' => $fallback]);
            Log::warning(
                "Session driver '{$driver}' is unavailable. Falling back to '{$fallback}'.",
                ['error' => $e->getMessage()]
            );
        }
    }
}
