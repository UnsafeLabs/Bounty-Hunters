<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    protected function tearDown(): void
    {
        DB::purge('sqlite');
        DB::purge('broken');

        parent::tearDown();
    }

    public function test_database_health_endpoint_returns_connection_details(): void
    {
        config([
            'database.default' => 'sqlite',
            'database.connections.sqlite.database' => ':memory:',
        ]);

        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJson([
                'status' => 'ok',
                'driver' => 'sqlite',
                'connection_name' => 'sqlite',
            ])
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
            ]);

        $this->assertIsNumeric($response->json('latency_ms'));
        $this->assertGreaterThanOrEqual(0, $response->json('latency_ms'));
    }

    public function test_database_health_endpoint_retries_then_returns_503_when_database_is_unreachable(): void
    {
        config([
            'database.default' => 'broken',
            'database.connections.broken' => [
                'driver' => 'sqlite',
                'database' => '/path/that/does/not/exist/database.sqlite',
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
        ]);

        $startedAt = microtime(true);

        $response = $this->getJson('/health/database');

        $elapsedMs = (microtime(true) - $startedAt) * 1000;

        $response->assertStatus(503)
            ->assertJson([
                'status' => 'error',
                'driver' => 'sqlite',
                'connection_name' => 'broken',
            ])
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
                'error',
            ]);

        $this->assertGreaterThanOrEqual(1000, $elapsedMs);
        $this->assertIsString($response->json('error'));
    }
}
