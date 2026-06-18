<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    public function test_database_health_endpoint_returns_connection_details(): void
    {
        config(['database.default' => 'sqlite']);

        $this->getJson('/health/database')
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
    }

    public function test_database_health_endpoint_retries_three_times_before_failure(): void
    {
        config([
            'database.default' => 'broken',
            'database.connections.broken.driver' => 'sqlite',
        ]);

        DB::shouldReceive('connection')
            ->times(3)
            ->with('broken')
            ->andThrow(new RuntimeException('database unavailable'));

        $this->getJson('/health/database')
            ->assertServiceUnavailable()
            ->assertJson([
                'status' => 'error',
                'driver' => 'sqlite',
                'connection_name' => 'broken',
                'attempts' => 3,
                'error' => 'database unavailable',
            ]);
    }
}
