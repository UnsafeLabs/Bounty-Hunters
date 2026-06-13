<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheStatusTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        CacheHealthCheck::clearMemoizedResults();
    }

    public function test_cache_status_command_outputs_driver_availability_and_latency(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
        ]);

        $this->artisan('cache:status --force')
            ->expectsOutput('Driver: array')
            ->expectsOutput('Store: array')
            ->expectsOutput('Available: yes')
            ->assertExitCode(0);
    }

    public function test_cache_status_command_fails_when_store_is_unavailable(): void
    {
        config([
            'cache.default' => 'missing',
            'cache.stores.missing' => [
                'driver' => 'not-a-real-cache-driver',
            ],
            'cache.health_check_enabled' => true,
        ]);

        $this->artisan('cache:status --force')
            ->expectsOutput('Driver: not-a-real-cache-driver')
            ->expectsOutput('Store: missing')
            ->expectsOutput('Available: no')
            ->assertExitCode(1);
    }

    public function test_cache_health_endpoint_returns_healthy_json(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
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
                'store',
                'latency_ms',
                'checked',
            ]);
    }

    public function test_cache_health_endpoint_returns_503_for_unavailable_cache(): void
    {
        config([
            'cache.default' => 'missing',
            'cache.stores.missing' => [
                'driver' => 'not-a-real-cache-driver',
            ],
            'cache.health_check_enabled' => true,
        ]);

        $this->getJson('/health/cache')
            ->assertStatus(503)
            ->assertJson([
                'available' => false,
                'driver' => 'not-a-real-cache-driver',
                'store' => 'missing',
            ])
            ->assertJsonStructure(['error']);
    }
}
