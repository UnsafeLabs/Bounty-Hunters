<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class WebRateLimitTest extends TestCase
{
    use RefreshDatabase;

    public function test_web_routes_are_rate_limited_after_sixty_requests(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertTooManyRequests();
    }

    public function test_rate_limiter_uses_user_id_or_ip(): void
    {
        $guestRequest = request();
        $guestRequest->server->set('REMOTE_ADDR', '203.0.113.10');

        $guestLimit = RateLimiter::limiter('web')($guestRequest);
        $this->assertSame('ip:203.0.113.10', $guestLimit->key);

        $user = User::factory()->create();
        $userRequest = request();
        $userRequest->setUserResolver(fn () => $user);

        $userLimit = RateLimiter::limiter('web')($userRequest);
        $this->assertSame('user:'.$user->getAuthIdentifier(), $userLimit->key);
    }

    public function test_debug_route_returns_rate_limit_metadata(): void
    {
        $this->get('/debug/rate-limit')
            ->assertOk()
            ->assertJsonPath('limit', 60)
            ->assertJsonPath('window', '1 minute')
            ->assertHeader('X-RateLimit-Limit', '60');
    }

    public function test_session_fallback_driver_defaults_to_file(): void
    {
        $this->assertSame('file', config('session.fallback'));
    }
}
