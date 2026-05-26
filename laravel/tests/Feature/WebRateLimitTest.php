<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\SessionDriverFallback;
use App\Support\WebRateLimit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class WebRateLimitTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        RateLimiter::clear('web|ip:127.0.0.1');
    }

    public function test_guest_requests_are_limited_after_sixty_hits(): void
    {
        for ($request = 0; $request < WebRateLimit::MAX_ATTEMPTS; $request++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')
            ->assertTooManyRequests()
            ->assertHeader('Retry-After');
    }

    public function test_rate_limit_key_distinguishes_authenticated_users_from_guests(): void
    {
        $user = User::factory()->create();

        RateLimiter::clear('web|user:'.$user->getAuthIdentifier());

        $this->actingAs($user);

        for ($request = 0; $request < WebRateLimit::MAX_ATTEMPTS; $request++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertTooManyRequests();

        $this->app['auth']->guard()->logout();

        $this->get('/')->assertOk();
    }

    public function test_debug_route_exposes_rate_limit_headers(): void
    {
        $this->getJson('/rate-limit/debug')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', (string) WebRateLimit::MAX_ATTEMPTS)
            ->assertJsonPath('headers.X-RateLimit-Limit', (string) WebRateLimit::MAX_ATTEMPTS)
            ->assertJsonPath('limit', WebRateLimit::MAX_ATTEMPTS);
    }

    public function test_session_driver_falls_back_when_configured_connection_is_missing(): void
    {
        config([
            'session.driver' => 'database',
            'session.connection' => 'missing-session-connection',
            'session.fallback' => 'file',
        ]);

        SessionDriverFallback::apply();

        $this->assertSame('file', config('session.driver'));
    }

    public function test_available_session_driver_is_preserved(): void
    {
        config([
            'session.driver' => 'array',
            'session.fallback' => 'file',
        ]);

        SessionDriverFallback::apply();

        $this->assertSame('array', config('session.driver'));
    }
}
