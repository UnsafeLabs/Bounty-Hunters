<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckRole
{
    public function handle(Request $request, Closure $next, string $role): Response
    {
        $user = $request->user();

        if (! $user) {
            abort(403, 'Unauthenticated.');
        }

        if (! method_exists($user, 'hasRole')) {
            abort(500, 'User model does not implement HasRoles trait.');
        }

        if (! $user->hasRole($role)) {
            abort(403, 'Forbidden: you do not have the required role.');
        }

        return $next($request);
    }
}
