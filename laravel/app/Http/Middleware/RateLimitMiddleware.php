<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class RateLimitMiddleware
{
    protected int $maxAttempts = 60;
    protected int $decayMinutes = 1;

    public function handle($request, Closure $next, $maxAttempts = null, $decayMinutes = null)
    {
        $this->maxAttempts = $maxAttempts ? (int)$maxAttempts : $this->maxAttempts;
        $this->decayMinutes = $decayMinutes ? (int)$decayMinutes : $this->decayMinutes;

        $key = $this->resolveRequestSignature($request);

        if ($this->tooManyAttempts($key)) {
            Log::warning("Rate limit hit", ['key' => $key, 'ip' => $request->ip()]);
            return response()->json([
                'message' => 'Too many attempts',
                'retry_after' => Cache::get("ratelimit:{$key}:timer") - time(),
            ], 429);
        }

        $this->incrementAttempts($key);

        $response = $next($request);

        if ($response instanceof Response) {
            $response->headers->set('X-RateLimit-Limit', $this->maxAttempts);
            $response->headers->set('X-RateLimit-Remaining', $this->remainingAttempts($key));
        }

        return $response;
    }

    protected function resolveRequestSignature($request): string
    {
        $ip = $request->ip();
        $route = $request->route()?->uri() ?? $request->path();
        return "ratelimit:{$ip}:{$route}";
    }

    protected function tooManyAttempts(string $key): bool
    {
        $attempts = Cache::get($key, 0);
        return $attempts >= $this->maxAttempts;
    }

    protected function incrementAttempts(string $key): void
    {
        $attempts = Cache::get($key, 0);
        Cache::put($key, $attempts + 1, $this->decayMinutes * 60);
        if ($attempts === 0) {
            Cache::put("{$key}:timer", time() + $this->decayMinutes * 60, $this->decayMinutes * 60);
        }
    }

    protected function remainingAttempts(string $key): int
    {
        $attempts = Cache::get($key, 0);
        return max(0, $this->maxAttempts - $attempts);
    }
}
