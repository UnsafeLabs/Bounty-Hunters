<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    public function test_database_health_endpoint_returns_connection_details(): void
    {
        $connection = Mockery::mock();
        $connection->shouldReceive('getPdo')->once()->andReturn(new class {});
        $connection->shouldReceive('getDriverName')->once()->andReturn('sqlite');

        DB::shouldReceive('getDefaultConnection')->once()->andReturn('sqlite');
        DB::shouldReceive('connection')->once()->with('sqlite')->andReturn($connection);

        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJson([
                'status' => 'ok',
                'driver' => 'sqlite',
                'connection_name' => 'sqlite',
            ])
            ->assertJsonStructure(['latency_ms']);

        $this->assertIsNumeric($response->json('latency_ms'));
    }

    public function test_database_health_endpoint_retries_three_times_before_failing(): void
    {
        config(['database.connections.mysql.driver' => 'mysql']);

        DB::shouldReceive('getDefaultConnection')->once()->andReturn('mysql');
        DB::shouldReceive('connection')
            ->times(3)
            ->with('mysql')
            ->andThrow(new RuntimeException('database unavailable'));

        $response = $this->getJson('/health/database');

        $response->assertStatus(503)
            ->assertJson([
                'status' => 'error',
                'driver' => 'mysql',
                'connection_name' => 'mysql',
                'error' => 'database unavailable',
            ])
            ->assertJsonStructure(['latency_ms']);

        $this->assertGreaterThanOrEqual(1000, $response->json('latency_ms'));
    }

    public function test_database_health_endpoint_succeeds_after_retry(): void
    {
        $connection = Mockery::mock();
        $connection->shouldReceive('getPdo')->once()->andReturn(new class {});
        $connection->shouldReceive('getDriverName')->once()->andReturn('pgsql');

        DB::shouldReceive('getDefaultConnection')->once()->andReturn('pgsql');
        DB::shouldReceive('connection')
            ->once()
            ->with('pgsql')
            ->andThrow(new RuntimeException('temporary failure'));
        DB::shouldReceive('connection')
            ->once()
            ->with('pgsql')
            ->andReturn($connection);

        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJson([
                'status' => 'ok',
                'driver' => 'pgsql',
                'connection_name' => 'pgsql',
            ]);

        $this->assertGreaterThanOrEqual(500, $response->json('latency_ms'));
    }
}
