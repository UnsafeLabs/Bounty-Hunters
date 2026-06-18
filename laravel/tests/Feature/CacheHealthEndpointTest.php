<?php

namespace Tests\Feature;

use Tests\TestCase;

class CacheHealthEndpointTest extends TestCase
{
    public function test_cache_health_endpoint_returns_ok_when_cache_is_available(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 0,
        ]);

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJson([
                'available' => true,
                'driver' => 'array',
                'store' => 'array',
            ])
            ->assertJsonStructure([
                'available',
                'driver',
                'latency_ms',
                'store',
                'checked_at',
            ]);
    }

    public function test_cache_health_endpoint_returns_service_unavailable_when_cache_is_unavailable(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 0,
        ]);

        $this->getJson('/health/cache')
            ->assertServiceUnavailable()
            ->assertJson([
                'available' => false,
                'driver' => 'unknown',
                'store' => 'missing-store',
            ]);
    }
}
