<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class RateLimitHeadersTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        RateLimiter::clear('127.0.0.1');
    }

    public function test_web_routes_include_rate_limit_headers(): void
    {
        $this->get('/rate-limit-headers')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', '60')
            ->assertHeader('X-RateLimit-Remaining')
            ->assertJsonPath('limit', 60)
            ->assertJsonPath('key_type', 'ip');
    }

    public function test_web_rate_limiter_returns_too_many_requests_after_sixty_requests(): void
    {
        for ($request = 1; $request <= 60; $request++) {
            $this->get('/rate-limit-headers')->assertOk();
        }

        $this->get('/rate-limit-headers')
            ->assertTooManyRequests()
            ->assertHeader('Retry-After');
    }

    public function test_session_fallback_driver_defaults_to_file(): void
    {
        $this->assertSame('file', config('session.fallback'));
    }
}
