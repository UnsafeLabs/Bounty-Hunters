<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class RateLimitingTest extends TestCase
{
    public function test_web_rate_limiter_keys_guests_by_ip_and_users_by_id(): void
    {
        $limiter = RateLimiter::limiter('web');

        $guestRequest = Request::create('/');
        $guestRequest->server->set('REMOTE_ADDR', '203.0.113.10');

        $userRequest = Request::create('/');
        $userRequest->server->set('REMOTE_ADDR', '203.0.113.10');
        $userRequest->setUserResolver(function () {
            $user = new User();
            $user->id = 42;

            return $user;
        });

        $this->assertSame('ip:203.0.113.10', $limiter($guestRequest)->key);
        $this->assertSame('user:42', $limiter($userRequest)->key);
    }

    public function test_web_routes_return_too_many_requests_after_sixty_hits(): void
    {
        RateLimiter::clear('ip:203.0.113.20');

        for ($attempt = 0; $attempt < 60; $attempt++) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20'])
                ->get('/rate-limit-status')
                ->assertOk();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20'])
            ->get('/rate-limit-status')
            ->assertTooManyRequests();
    }

    public function test_rate_limit_status_route_exposes_debug_headers(): void
    {
        RateLimiter::clear('ip:203.0.113.30');

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.30'])
            ->get('/rate-limit-status')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', '60')
            ->assertHeader('X-RateLimit-Remaining');
    }
}
