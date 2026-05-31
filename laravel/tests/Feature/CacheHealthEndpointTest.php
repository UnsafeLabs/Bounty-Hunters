<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Mockery;
use Tests\TestCase;

class CacheHealthEndpointTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
    }

    public function test_cache_health_endpoint_returns_ok_for_available_cache(): void
    {
        config()->set('cache.default', 'array');

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('driver', 'array')
            ->assertJsonPath('store', 'array')
            ->assertJsonStructure([
                'available',
                'driver',
                'latency_ms',
                'store',
                'checked',
                'cached',
            ]);
    }

    public function test_cache_health_endpoint_returns_service_unavailable_for_failed_cache(): void
    {
        $healthCheck = Mockery::mock(CacheHealthCheck::class);
        $healthCheck->shouldReceive('check')->once()->andReturn([
            'available' => false,
            'driver' => 'redis',
            'latency_ms' => 4.5,
            'store' => 'redis',
            'checked' => true,
            'cached' => false,
            'error' => 'redis offline',
        ]);

        $this->app->instance(CacheHealthCheck::class, $healthCheck);

        $this->getJson('/health/cache')
            ->assertStatus(503)
            ->assertJsonPath('available', false)
            ->assertJsonPath('driver', 'redis')
            ->assertJsonPath('error', 'redis offline');
    }
}
