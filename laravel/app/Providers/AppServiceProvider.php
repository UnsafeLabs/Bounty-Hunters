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
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('throttle', function (Request $request) {
            if ($request->user()) {
                return Limit::perMinute(60)->by($request->user()->id);
            }

            return Limit::perMinute(60)->by(
                $request->ip() . ':' . $request->header('User-Agent', 'unknown')
            );
        });
    }
}