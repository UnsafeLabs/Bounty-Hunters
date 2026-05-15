<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Foundation\Testing\TestCase;

class DatabaseHealthCheckTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
    }

    public function test_health_endpoint_returns_200_when_connected(): void
    {
        $response = $this->getJson('/health/database');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'status', 'driver', 'database', 'latency_ms', 'timestamp', 'attempts',
        ]);
        $this->assertEquals('healthy', $response->json('status'));
    }

    public function test_health_check_includes_latency(): void
    {
        $response = $this->getJson('/health/database');

        $response->assertStatus(200);
        $this->assertIsFloat($response->json('latency_ms'));
        $this->assertGreaterThan(0, $response->json('latency_ms'));
    }

    public function test_health_check_includes_driver_info(): void
    {
        $response = $this->getJson('/health/database');

        $response->assertStatus(200);
        $this->assertNotEmpty($response->json('driver'));
        $this->assertNotEmpty($response->json('database'));
    }

    public function test_health_endpoint_returns_503_on_failure(): void
    {
        DB::shouldReceive('connection->getPdo')->andThrow(new \RuntimeException('Connection refused'));

        $response = $this->getJson('/health/database');

        $response->assertStatus(503);
        $this->assertEquals('unhealthy', $response->json('status'));
        $this->assertArrayHasKey('error', $response->json());
    }

    public function test_retry_count_returned_in_response(): void
    {
        $response = $this->getJson('/health/database');

        $response->assertStatus(200);
        $this->assertGreaterThanOrEqual(1, $response->json('attempts'));
        $this->assertLessThanOrEqual(3, $response->json('attempts'));
    }
}
