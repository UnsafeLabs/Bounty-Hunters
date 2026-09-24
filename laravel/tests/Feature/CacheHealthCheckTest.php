<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    /**
     * Point the default store at an unconfigured redis connection so that
     * resolving the store throws immediately (no network, no timeout).
     */
    private function configureBrokenStore(): void
    {
        config([
            'cache.default' => 'broken',
            'cache.stores.broken' => [
                'driver' => 'redis',
                'connection' => 'does-not-exist',
            ],
        ]);
    }

    public function test_reports_active_store_as_available(): void
    {
        config(['cache.default' => 'array']);

        $result = (new CacheHealthCheck)->check(force: true);

        $this->assertTrue($result['available']);
        $this->assertSame('array', $result['driver']);
        $this->assertIsFloat($result['latency_ms']);
        $this->assertFalse($result['cached']);
    }

    public function test_reports_unavailable_store_when_resolution_fails(): void
    {
        $this->configureBrokenStore();

        $result = (new CacheHealthCheck)->check(force: true);

        $this->assertFalse($result['available']);
        $this->assertSame('broken', $result['driver']);
        $this->assertNull($result['latency_ms']);
    }

    public function test_health_check_interval_memoizes_the_result(): void
    {
        config(['cache.default' => 'array']);

        $health = new CacheHealthCheck(interval: 300);

        $first = $health->check(force: true);
        $this->assertTrue($first['available']);
        $this->assertFalse($first['cached']);

        // Store becomes unavailable, but the memoized result should still win.
        $this->configureBrokenStore();

        $second = $health->check();

        $this->assertTrue($second['available']);
        $this->assertTrue($second['cached']);

        // Forcing bypasses the interval.
        $forced = $health->check(force: true);

        $this->assertFalse($forced['available']);
        $this->assertFalse($forced['cached']);
    }

    public function test_route_returns_200_when_cache_is_healthy(): void
    {
        config(['cache.default' => 'array']);

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJson([
                'available' => true,
                'driver' => 'array',
            ]);
    }

    public function test_route_returns_503_when_cache_is_unavailable(): void
    {
        $this->configureBrokenStore();

        $this->getJson('/health/cache')
            ->assertStatus(503)
            ->assertJson([
                'available' => false,
                'driver' => 'broken',
            ]);
    }

    public function test_route_reports_when_health_checks_are_disabled(): void
    {
        config(['cache.health_check_enabled' => false]);

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJson([
                'enabled' => false,
                'available' => true,
            ]);
    }
}
