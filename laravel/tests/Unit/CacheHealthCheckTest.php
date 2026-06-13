<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        CacheHealthCheck::clearMemoizedResults();
    }

    public function test_it_reports_the_configured_cache_store_as_available(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
        ]);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertSame('array', $status['store']);
        $this->assertIsFloat($status['latency_ms']);
        $this->assertFalse($status['cached']);
    }

    public function test_it_reports_unavailable_cache_stores(): void
    {
        config([
            'cache.default' => 'missing',
            'cache.stores.missing' => [
                'driver' => 'not-a-real-cache-driver',
            ],
            'cache.health_check_enabled' => true,
        ]);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertFalse($status['available']);
        $this->assertSame('not-a-real-cache-driver', $status['driver']);
        $this->assertSame('missing', $status['store']);
        $this->assertArrayHasKey('error', $status);
    }

    public function test_it_respects_disabled_health_checks(): void
    {
        config([
            'cache.default' => 'missing',
            'cache.stores.missing' => [
                'driver' => 'not-a-real-cache-driver',
            ],
            'cache.health_check_enabled' => false,
        ]);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertFalse($status['checked']);
        $this->assertSame(0.0, $status['latency_ms']);
    }

    public function test_it_memoizes_results_within_the_configured_interval(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 300,
        ]);

        $healthCheck = app(CacheHealthCheck::class);

        $this->assertFalse($healthCheck->check()['cached']);
        $this->assertTrue($healthCheck->check()['cached']);
        $this->assertFalse($healthCheck->check(force: true)['cached']);
    }
}
