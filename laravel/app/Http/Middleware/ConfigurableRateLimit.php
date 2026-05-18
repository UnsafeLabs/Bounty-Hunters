<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fix: Add rate limiting middleware to web routes with configurable limits (#749)
 */
class ConfigurableRateLimit
{
    protected RateLimiter $limiter;

    protected array $routeLimits = [
        'api/*' => ['max_attempts' => 60, 'decay_minutes' => 1],
        'auth/login' => ['max_attempts' => 5, 'decay_minutes' => 15],
        'auth/register' => ['max_attempts' => 3, 'decay_minutes' => 60],
        'web/*' => ['max_attempts' => 120, 'decay_minutes' => 1],
    ];

    public function __construct(RateLimiter $limiter)
    {
        $this->limiter = $limiter;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $limits = $this->getLimitsForRoute($request->path());

        $key = $this->resolveRequestSignature($request);

        if ($this->limiter->tooManyAttempts($key, $limits['max_attempts'])) {
            $retryAfter = $this->limiter->availableIn($key);

            return response()->json([
                'message' => 'Too many requests.',
                'retry_after' => $retryAfter,
            ], 429, ['Retry-After' => $retryAfter]);
        }

        $this->limiter->hit($key, $limits['decay_minutes'] * 60);

        $response = $next($request);

        $remaining = $limits['max_attempts'] - $this->limiter->attempts($key);
        $response->headers->set('X-RateLimit-Limit', $limits['max_attempts']);
        $response->headers->set('X-RateLimit-Remaining', max(0, $remaining));

        return $response;
    }

    protected function getLimitsForRoute(string $path): array
    {
        foreach ($this->routeLimits as $pattern => $limits) {
            if (str_is($pattern, $path)) {
                return $limits;
            }
        }

        return ['max_attempts' => 100, 'decay_minutes' => 1];
    }

    protected function resolveRequestSignature(Request $request): string
    {
        return sha1($request->ip() . '|' . $request->path());
    }
}
