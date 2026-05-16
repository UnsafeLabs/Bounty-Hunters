<?php

namespace Tests\Feature;

use Illuminate\Console\Command;
use Tests\TestCase;

class CacheHealthTest extends TestCase
{
    public function test_health_endpoint_returns_ok_for_available_cache_store(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_interval' => 0,
        ]);

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJson([
                'available' => true,
                'driver' => 'array',
            ])
            ->assertJsonStructure([
                'available',
                'driver',
                'latency_ms',
            ]);
    }

    public function test_health_endpoint_returns_service_unavailable_for_unavailable_cache_store(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_interval' => 0,
        ]);

        $this->getJson('/health/cache')
            ->assertStatus(503)
            ->assertJson([
                'available' => false,
                'driver' => 'unknown',
            ]);
    }

    public function test_cache_status_command_outputs_health_details(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_interval' => 0,
        ]);

        $this->artisan('cache:status --force')
            ->expectsOutputToContain('Driver: array')
            ->expectsOutputToContain('Availability: available')
            ->expectsOutputToContain('Latency:')
            ->assertExitCode(Command::SUCCESS);
    }

    public function test_cache_status_command_fails_when_cache_store_is_unavailable(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_interval' => 0,
        ]);

        $this->artisan('cache:status --force')
            ->expectsOutputToContain('Availability: unavailable')
            ->assertExitCode(Command::FAILURE);
    }
}
