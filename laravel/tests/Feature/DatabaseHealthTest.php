<?php

namespace Tests\Feature;

use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    public function test_database_health_endpoint_returns_connection_details(): void
    {
        config([
            'database.default' => 'health_sqlite',
            'database.connections.health_sqlite' => [
                'driver' => 'sqlite',
                'database' => ':memory:',
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
        ]);

        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('driver', 'sqlite')
            ->assertJsonPath('connection_name', 'health_sqlite')
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
            ]);

        $this->assertIsNumeric($response->json('latency_ms'));
    }

    public function test_database_health_endpoint_returns_service_unavailable_on_failure(): void
    {
        config([
            'database.default' => 'health_missing',
            'database.connections.health_missing' => [
                'driver' => 'sqlite',
                'database' => database_path('missing/health.sqlite'),
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
        ]);

        $response = $this->getJson('/health/database');

        $response->assertStatus(503)
            ->assertJsonPath('status', 'error')
            ->assertJsonPath('driver', 'sqlite')
            ->assertJsonPath('connection_name', 'health_missing')
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
                'error',
            ]);
    }
}
