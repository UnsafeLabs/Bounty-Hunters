<?php

namespace App\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RoleBasedAccessControl
{
    public function handle(Request $request, Closure $next, string $role = null): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($role && !$this->hasRole($user, $role)) {
            return response()->json(['message' => 'Insufficient permissions.'], 403);
        }

        return $next($request);
    }

    private function hasRole($user, string $role): bool
    {
        $roles = config('roles', []);

        $userRole = $user->role ?? 'user';

        if (!isset($roles[$userRole])) {
            return false;
        }

        $permissions = $roles[$userRole]['permissions'] ?? [];

        return in_array($role, $permissions) || $userRole === $role;
    }
}
