<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    public function test_database_health_endpoint_returns_connection_details(): void
    {
        $response = $this->getJson('/health/database');

        $response
            ->assertOk()
            ->assertJson([
                'status' => 'ok',
                'driver' => 'sqlite',
                'connection_name' => 'sqlite',
                'attempts' => 1,
            ])
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
                'attempts',
            ]);

        $this->assertIsNumeric($response->json('latency_ms'));
        $this->assertGreaterThanOrEqual(0, $response->json('latency_ms'));
    }

    public function test_database_health_endpoint_returns_service_unavailable_after_retries(): void
    {
        config(['database.connections.sqlite.database' => database_path('missing/database.sqlite')]);
        DB::purge('sqlite');

        $response = $this->getJson('/health/database');

        $response
            ->assertStatus(503)
            ->assertJson([
                'status' => 'error',
                'driver' => 'sqlite',
                'connection_name' => 'sqlite',
                'attempts' => 3,
            ])
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
                'attempts',
                'error',
            ]);

        $this->assertNotEmpty($response->json('error'));
        $this->assertIsNumeric($response->json('latency_ms'));
    }

    protected function tearDown(): void
    {
        DB::purge('sqlite');

        parent::tearDown();
    }
}
