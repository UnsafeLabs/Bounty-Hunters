<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckRole
{
    /**
     * @param Closure(Request): Response $next
     */
    public function handle(Request $request, Closure $next, string $role): Response
    {
        $user = $request->user();

        if (! $user || ! method_exists($user, 'hasRole') || ! $user->hasRole($role)) {
            abort(Response::HTTP_FORBIDDEN);
        }

        return $next($request);
    }
}
