<?php

namespace App\Providers;

use App\Support\SessionDriverFallback;
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
        SessionDriverFallback::apply();
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('web', function (Request $request) {
            return Limit::perMinute(WebRateLimit::MAX_ATTEMPTS)
                ->by(WebRateLimit::key($request));
        });
    }
}
