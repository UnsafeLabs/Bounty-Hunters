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

        abort_if(! $user || ! method_exists($user, 'hasRole') || ! $user->hasRole($role), 403);

        return $next($request);
    }
}
