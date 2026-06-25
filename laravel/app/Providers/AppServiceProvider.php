<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Support\Facades\Gate;
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
        // Resolve authorization abilities against a user's role permissions, so
        // `$user->can('edit-posts')`, the `can` middleware and `@can` Blade
        // directive all honour role-based access control out of the box.
        Gate::before(function (?User $user, string $ability) {
            return $user?->hasPermission($ability) ? true : null;
        });
    }
}
