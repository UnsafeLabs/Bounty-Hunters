<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Cache;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->extend('config', function ($config, $app) {
            $cached = Cache::get('app.config.cached');
            if ($cached && is_array($cached)) {
                foreach ($cached as $key => $value) {
                    if (!$config->has($key)) {
                        $config->set($key, $value);
                    }
                }
            }
            return $config;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        try {
            Cache::store()->getStore()->get('app.config.health');
        } catch (\Exception $e) {
            report(new \Exception('Cache store connection failed: ' . $e->getMessage()));
        }
    }
}
