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

        RateLimiter::clear('web:ip:127.0.0.1');
    }

    public function test_guest_web_requests_are_limited_after_sixty_attempts_per_minute(): void
    {
        for ($attempt = 0; $attempt < WebRateLimit::MAX_ATTEMPTS; $attempt++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertTooManyRequests();
    }

    public function test_authenticated_users_have_a_separate_rate_limit_key_from_guest_ip(): void
    {
        for ($attempt = 0; $attempt < WebRateLimit::MAX_ATTEMPTS; $attempt++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertTooManyRequests();

        $user = User::factory()->create();

        $this->actingAs($user)
            ->get('/')
            ->assertOk();
    }

    public function test_debug_route_returns_current_rate_limit_headers(): void
    {
        $this->getJson('/rate-limit/debug')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', (string) WebRateLimit::MAX_ATTEMPTS)
            ->assertJsonStructure([
                'key',
                'limit',
                'remaining',
                'retry_after',
            ])
            ->assertJson([
                'key' => 'web:ip:127.0.0.1',
                'limit' => WebRateLimit::MAX_ATTEMPTS,
            ]);
    }

    public function test_session_fallback_configuration_defaults_to_file(): void
    {
        $this->assertSame('file', config('session.fallback'));
        $this->assertSame('file', SessionDriverFallback::resolveDriver(''));

        config(['session.fallback' => 'array']);

        $this->assertSame('array', SessionDriverFallback::fallbackDriver());
        $this->assertSame('array', SessionDriverFallback::resolveDriver(''));
    }
}
