<?php

namespace Tests\Feature;

use App\Models\User;
use App\Providers\AppServiceProvider;
use Tests\TestCase;

class RateLimitTest extends TestCase
{
    public function test_guest_hits_429_after_60_requests_per_minute(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->get('/')->assertStatus(200);
        }

        $this->get('/')->assertStatus(429);
    }

    public function test_rate_limit_headers_are_present_on_throttled_routes(): void
    {
        $this->get('/debug/rate-limit')
            ->assertStatus(200)
            ->assertHeader('X-RateLimit-Limit')
            ->assertJsonPath('limiter', 'web')
            ->assertJsonPath('limit', 60);
    }

    public function test_authenticated_limit_is_keyed_by_user_not_ip(): void
    {
        $user = User::factory()->make(['id' => 7]);

        for ($i = 0; $i < 60; $i++) {
            $this->actingAs($user)->get('/')->assertStatus(200);
        }

        // A different source IP with the same user still shares the user bucket.
        $this->actingAs($user)->get('/', ['REMOTE_ADDR' => '203.0.113.99'])->assertStatus(429);
    }

    public function test_guest_buckets_are_keyed_by_ip(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->get('/', ['REMOTE_ADDR' => '198.51.100.7'])->assertStatus(200);
        }

        $this->get('/', ['REMOTE_ADDR' => '198.51.100.7'])->assertStatus(429);

        // A different IP still has its own budget.
        $this->get('/', ['REMOTE_ADDR' => '198.51.100.8'])->assertStatus(200);
    }

    public function test_session_driver_falls_back_when_primary_driver_is_unavailable(): void
    {
        // A misconfigured/unknown driver cannot be resolved by the session manager.
        config(['session.driver' => 'not-a-real-driver', 'session.fallback' => 'file']);

        (new AppServiceProvider($this->app))->boot();

        $this->assertSame('file', config('session.driver'));
    }

    public function test_session_driver_is_untouched_when_primary_is_local(): void
    {
        config(['session.driver' => 'array', 'session.fallback' => 'file']);

        (new AppServiceProvider($this->app))->boot();

        $this->assertSame('array', config('session.driver'));
    }
}
