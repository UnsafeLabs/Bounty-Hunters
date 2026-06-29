<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_cache_health_endpoint_returns_json_status(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
        ]);

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('driver', 'array')
            ->assertJsonStructure([
                'available',
                'driver',
                'latency_ms',
                'enabled',
                'interval',
            ]);
    }

    public function test_cache_health_endpoint_returns_503_when_store_is_unavailable(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_enabled' => true,
        ]);

        $this->getJson('/health/cache')
            ->assertServiceUnavailable()
            ->assertJsonPath('available', false)
            ->assertJsonPath('driver', 'missing-store');
    }

    public function test_cache_status_command_outputs_driver_availability_and_latency(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
        ]);

        $this->artisan('cache:status')
            ->expectsOutput('Cache driver: array')
            ->expectsOutput('Available: yes')
            ->assertExitCode(0);
    }
}
