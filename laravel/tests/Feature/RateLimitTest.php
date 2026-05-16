<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class RateLimitTest extends TestCase
{
    use RefreshDatabase;

    public function test_rate_limit_returns_429_after_exceeding(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $response = $this->get('/');
            $response->assertStatus(200);
            if ($response->status() === 429) {
                break;
            }
        }

        $response = $this->get('/');
        $this->assertEquals(429, $response->status());
    }

    public function test_custom_rate_limiter_distinguishes_users(): void
    {
        $user = User::factory()->create();

        for ($i = 0; $i < 60; $i++) {
            $this->actingAs($user)->get('/');
        }

        $response = $this->actingAs($user)->get('/');
        $this->assertEquals(429, $response->status());

        $guestResponse = $this->get('/');
        $this->assertEquals(200, $guestResponse->status());
    }

    public function test_guests_identified_by_ip_and_ua(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->get('/', ['User-Agent' => 'GuestBot/1.0']);
        }

        $response = $this->get('/', ['User-Agent' => 'GuestBot/1.0']);
        $this->assertEquals(429, $response->status());
    }

    public function test_debug_route_returns_rate_limit_headers(): void
    {
        $response = $this->get('/rate-limit-debug');
        $response->assertStatus(200);
        $response->assertJsonStructure(['limit', 'remaining', 'reset', 'user']);
    }

    public function test_session_fallback_configured(): void
    {
        $fallback = config('session.fallback');
        $this->assertNotEmpty($fallback);
        $this->assertEquals('file', $fallback);
    }
}