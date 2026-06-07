<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheStatusCommandTest extends TestCase
{
    public function test_cache_status_command_outputs_driver_availability_and_latency(): void
    {
        config()->set('cache.default', 'array');

        $this->artisan('cache:status')
            ->expectsOutput('Driver: array')
            ->expectsOutput('Available: yes')
            ->expectsOutputToContain('Latency: ')
            ->assertSuccessful();
    }

    public function test_cache_status_command_fails_when_store_is_unavailable(): void
    {
        $this->mock(CacheHealthCheck::class)
            ->shouldReceive('check')
            ->with('redis')
            ->once()
            ->andReturn([
                'available' => false,
                'driver' => 'redis',
                'latency_ms' => 1.23,
                'message' => 'connection refused',
            ]);

        $this->artisan('cache:status redis')
            ->expectsOutput('Driver: redis')
            ->expectsOutput('Available: no')
            ->expectsOutput('Latency: 1.23ms')
            ->expectsOutput('Message: connection refused')
            ->assertFailed();
    }

    public function test_cache_health_endpoint_returns_healthy_json(): void
    {
        config()->set('cache.default', 'array');

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('driver', 'array')
            ->assertJsonStructure(['available', 'driver', 'latency_ms']);
    }

    public function test_cache_health_endpoint_returns_503_when_unavailable(): void
    {
        $this->mock(CacheHealthCheck::class)
            ->shouldReceive('check')
            ->once()
            ->andReturn([
                'available' => false,
                'driver' => 'redis',
                'latency_ms' => 1.23,
                'message' => 'connection refused',
            ]);

        $this->getJson('/health/cache')
            ->assertStatus(503)
            ->assertJsonPath('available', false)
            ->assertJsonPath('driver', 'redis')
            ->assertJsonPath('message', 'connection refused');
    }
}
