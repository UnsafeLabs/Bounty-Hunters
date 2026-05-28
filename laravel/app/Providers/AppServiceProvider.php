<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\RateLimiter;

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
     *
     * Defines custom rate limiters for the application.
     */
    public function boot(): void
    {
        // Web routes rate limiter: 60 requests per minute
        // Distinguishes between authenticated users and guests
        RateLimiter::for('web', function ($request) {
            return $request->user()
                ? Limit::perMinute(60)->by($request->user()->id)
                : Limit::perMinute(60)->by($request->ip());
        });

        // API rate limiter: 60 requests per minute
        RateLimiter::for('api', function ($request) {
            return $request->user()
                ? Limit::perMinute(60)->by($request->user()->id)
                : Limit::perMinute(30)->by($request->ip());
        });

        // Auth rate limiter: stricter limits for login attempts
        RateLimiter::for('auth', function ($request) {
            return Limit::perMinute(5)->by(
                $request->email . $request->ip()
            );
        });
    }
}
