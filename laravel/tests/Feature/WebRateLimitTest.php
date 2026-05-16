<?php

namespace Tests\Feature;

use App\Providers\AppServiceProvider;
use App\Support\WebRateLimit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class WebRateLimitTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $request = Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR' => '127.0.0.1']);
        RateLimiter::clear(WebRateLimit::storageKey($request));
    }

    public function test_guest_web_routes_are_limited_after_sixty_requests(): void
    {
        for ($i = 0; $i < WebRateLimit::MAX_ATTEMPTS; $i++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertStatus(429);
    }

    public function test_debug_route_returns_rate_limit_details_and_headers(): void
    {
        $this->get('/rate-limit/debug')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', (string) WebRateLimit::MAX_ATTEMPTS)
            ->assertJsonPath('limit', WebRateLimit::MAX_ATTEMPTS)
            ->assertJsonPath('source.type', 'ip');
    }

    public function test_rate_limit_key_uses_authenticated_user_before_ip(): void
    {
        $request = Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR' => '203.0.113.10']);
        $request->setUserResolver(fn () => new class {
            public function getAuthIdentifier(): int
            {
                return 42;
            }
        });

        $this->assertSame('web:user:42', WebRateLimit::key($request));
    }

    public function test_session_driver_falls_back_when_configured_store_is_missing(): void
    {
        config([
            'session.driver' => 'redis',
            'session.store' => 'missing-store',
            'session.fallback' => 'file',
        ]);

        (new AppServiceProvider(app()))->boot();

        $this->assertSame('file', config('session.driver'));
    }

    public function test_session_driver_keeps_available_primary_driver(): void
    {
        config([
            'session.driver' => 'array',
            'session.fallback' => 'file',
        ]);

        (new AppServiceProvider(app()))->boot();

        $this->assertSame('array', config('session.driver'));
    }
}
