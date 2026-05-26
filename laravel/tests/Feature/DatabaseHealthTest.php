<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use stdClass;
use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    public function test_database_health_endpoint_returns_connection_details(): void
    {
        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('driver', 'sqlite')
            ->assertJsonPath('connection_name', 'sqlite')
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
            ]);

        $this->assertIsNumeric($response->json('latency_ms'));
    }

    public function test_database_health_endpoint_retries_before_success(): void
    {
        $connection = Mockery::mock();
        $connection->shouldReceive('getPdo')->once()->andReturn(new stdClass);

        DB::shouldReceive('getDefaultConnection')->once()->andReturn('sqlite');
        DB::shouldReceive('connection')->once()->with('sqlite')->andThrow(
            new RuntimeException('temporary failure')
        );
        DB::shouldReceive('connection')->once()->with('sqlite')->andThrow(
            new RuntimeException('temporary failure')
        );
        DB::shouldReceive('connection')->once()->with('sqlite')->andReturn($connection);

        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('driver', 'sqlite')
            ->assertJsonPath('connection_name', 'sqlite');
    }

    public function test_database_health_endpoint_returns_503_after_retries_fail(): void
    {
        DB::shouldReceive('getDefaultConnection')->once()->andReturn('sqlite');
        DB::shouldReceive('connection')->times(3)->with('sqlite')->andThrow(
            new RuntimeException('database unavailable')
        );

        $response = $this->getJson('/health/database');

        $response->assertStatus(503)
            ->assertJsonPath('status', 'error')
            ->assertJsonPath('driver', 'sqlite')
            ->assertJsonPath('connection_name', 'sqlite')
            ->assertJsonPath('error', 'database unavailable');
    }
}
