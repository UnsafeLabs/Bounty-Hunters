<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class RateLimitMiddleware
{
    public function handle(Request $request, Closure $next, int $maxAttempts = 60, int $decayMinutes = 1): Response
    {
        $key = 'rate_limit:' . $request->ip();

        if (Cache::has($key . ':lockout')) {
            return response()->json([
                'message' => 'Too many requests. Please try again later.',
            ], 429);
        }

        $attempts = Cache::get($key, 0);

        if ($attempts >= $maxAttempts) {
            Cache::put($key . ':lockout', true, now()->addMinutes($decayMinutes));
            return response()->json([
                'message' => 'Too many requests. Please try again later.',
            ], 429);
        }

        Cache::increment($key);
        Cache::put($key, $attempts + 1, now()->addMinutes($decayMinutes));

        return $next($request);
    }
}
