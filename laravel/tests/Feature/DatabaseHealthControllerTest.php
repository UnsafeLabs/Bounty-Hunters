<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class DatabaseHealthControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_database_health_endpoint_returns_connection_details(): void
    {
        $response = $this->getJson('/health/database');

        $response
            ->assertOk()
            ->assertJson([
                'status' => 'healthy',
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
    }

    public function test_database_health_endpoint_returns_503_when_connection_fails(): void
    {
        Config::set('database.health_check.retry_delay_ms', 0);
        DB::shouldReceive('connection')
            ->times(3)
            ->with('sqlite')
            ->andThrow(new RuntimeException('database unavailable'));

        $response = $this->getJson('/health/database');

        $response
            ->assertStatus(503)
            ->assertJson([
                'status' => 'unhealthy',
                'driver' => 'sqlite',
                'connection_name' => 'sqlite',
                'error' => 'database unavailable',
            ])
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
                'error',
            ]);

        $this->assertIsNumeric($response->json('latency_ms'));
    }
}
