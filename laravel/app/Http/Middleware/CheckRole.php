<?php

namespace App\Http\Middleware;

use App\Traits\HasRoles;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckRole
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next, string $role): Response
    {
        $user = $request->user();

        if (! $user) {
            abort(401, 'Unauthenticated.');
        }

        // Check if the User model uses the HasRoles trait
        if (! in_array(HasRoles::class, class_uses_recursive($user::class))) {
            abort(403, 'User model does not support roles.');
        }

        if (! $user->hasRole($role)) {
            abort(403, "Access denied. Required role: {$role}");
        }

        return $next($request);
    }
}
