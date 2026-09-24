<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
        RateLimiter::for('web', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        $this->ensureSessionDriverIsAvailable();
    }

    protected function ensureSessionDriverIsAvailable(): void
    {
        $driver = config('session.driver');
        $fallback = config('session.fallback', 'file');

        if ($driver === $fallback || in_array($driver, ['file', 'cookie', 'array'], true)) {
            return;
        }

        try {
            match ($driver) {
                'database' => DB::connection()->getPdo(),
                'redis' => app('redis')->connection()->ping(),
                default => app('session')->driver($driver),
            };
        } catch (\Throwable) {
            config(['session.driver' => $fallback]);
        }
    }
}
