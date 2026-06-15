<?php

namespace Tests\Feature;

use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class RateLimitHeadersTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    public function test_web_routes_include_rate_limit_headers(): void
    {
        $response = $this->get('/rate-limit-headers');

        $response->assertOk()
            ->assertHeader('X-RateLimit-Limit', '60')
            ->assertHeader('X-RateLimit-Remaining', '59')
            ->assertJson([
                'limit' => 60,
                'window_seconds' => 60,
                'key_type' => 'ip',
            ]);
    }

    public function test_web_routes_return_too_many_requests_after_sixty_requests(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->get('/')->assertOk();
        }

        $this->get('/')->assertTooManyRequests();
    }

    public function test_authenticated_users_are_limited_separately_from_guests(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->get('/')->assertOk();
        }

        $this->actingAs(User::factory()->make(['id' => 123]))
            ->get('/')
            ->assertOk();
    }

    public function test_session_fallback_defaults_to_file(): void
    {
        $this->assertSame('file', config('session.fallback'));
    }

    public function test_unsupported_session_driver_falls_back_to_configured_fallback(): void
    {
        config([
            'session.driver' => 'missing-backend',
            'session.fallback' => 'file',
        ]);

        (new AppServiceProvider($this->app))->register();

        $this->assertSame('file', config('session.driver'));
    }
}
