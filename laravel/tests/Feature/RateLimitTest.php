<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class RateLimitTest extends TestCase
{
    use RefreshDatabase;

    public function test_web_routes_are_rate_limited_for_guests_by_ip(): void
    {
        RateLimiter::clear('web:127.0.0.1');

        for ($i = 0; $i < 60; $i++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertStatus(429);
    }

    public function test_rate_limiter_distinguishes_authenticated_users(): void
    {
        $firstUser = User::factory()->create();
        $secondUser = User::factory()->create();

        RateLimiter::clear('web:'.$firstUser->getAuthIdentifier());
        RateLimiter::clear('web:'.$secondUser->getAuthIdentifier());

        for ($i = 0; $i < 60; $i++) {
            $this->actingAs($firstUser)->get('/')->assertOk();
        }

        $this->actingAs($firstUser)->get('/')->assertStatus(429);
        $this->actingAs($secondUser)->get('/')->assertOk();
    }

    public function test_debug_route_returns_rate_limit_headers(): void
    {
        RateLimiter::clear('web:127.0.0.1');

        $this->get('/rate-limit/debug')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', '60')
            ->assertJsonPath('limit', 60);
    }

    public function test_session_fallback_driver_is_configured(): void
    {
        $this->assertSame('file', config('session.fallback'));
    }
}
