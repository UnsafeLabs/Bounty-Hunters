<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckRole
{
    /**
     * Ensure the authenticated user has at least one of the given roles.
     *
     * Usage: Route::middleware('role:admin')->...   (or 'role:admin,editor').
     * Aborts with a 403 response when there is no authenticated user, the user
     * model does not support roles, or it holds none of the required roles.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if ($user === null || ! method_exists($user, 'hasAnyRole') || ! $user->hasAnyRole(...$roles)) {
            abort(Response::HTTP_FORBIDDEN);
        }

        return $next($request);
    }
}
