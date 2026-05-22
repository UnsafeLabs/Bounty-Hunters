<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_cache_health_check_returns_expected_structure(): void
    {
        $healthCheck = new CacheHealthCheck();
        $result = $healthCheck->check();

        $this->assertIsArray($result);
        $this->assertArrayHasKey('available', $result);
        $this->assertArrayHasKey('driver', $result);
        $this->assertArrayHasKey('latency_ms', $result);
        $this->assertIsBool($result['available']);
        $this->assertIsString($result['driver']);
        $this->assertIsFloat($result['latency_ms']);
    }

    public function test_cache_health_check_reports_array_store_as_available(): void
    {
        config(['cache.default' => 'array']);

        $healthCheck = new CacheHealthCheck();
        $result = $healthCheck->check();

        $this->assertTrue($result['available']);
        $this->assertEquals('array', $result['driver']);
    }

    public function test_cache_health_check_endpoint_returns_healthy_for_available_cache(): void
    {
        config(['cache.default' => 'array']);

        $response = $this->getJson('/api/health/cache');

        $response->assertStatus(200)
            ->assertJson([
                'status' => 'healthy',
                'driver' => 'array',
            ])
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
            ]);
    }

    public function test_cache_health_check_endpoint_returns_proper_json_structure(): void
    {
        config(['cache.default' => 'array']);

        $response = $this->getJson('/api/health/cache');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
            ]);
    }

    public function test_health_check_latency_is_reasonable(): void
    {
        config(['cache.default' => 'array']);

        $healthCheck = new CacheHealthCheck();
        $result = $healthCheck->check();

        // Array store should be very fast - less than 100ms
        $this->assertLessThan(100, $result['latency_ms']);
    }
}
