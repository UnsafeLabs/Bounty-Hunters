<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_cache_health_check_reports_available_store_with_latency(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 123,
        ]);

        $status = (new CacheHealthCheck)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertSame(123, $status['interval']);
        $this->assertGreaterThanOrEqual(0, $status['latency_ms']);
    }

    public function test_cache_health_check_respects_disabled_config(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => false,
            'cache.health_check_interval' => 456,
        ]);

        $status = (new CacheHealthCheck)->check();

        $this->assertTrue($status['available']);
        $this->assertFalse($status['enabled']);
        $this->assertSame(456, $status['interval']);
        $this->assertSame(0.0, $status['latency_ms']);
    }
}
