<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_it_reports_the_active_cache_store_as_available(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 300,
        ]);

        $result = app(CacheHealthCheck::class)->check(force: true);

        $this->assertTrue($result['available']);
        $this->assertSame('array', $result['driver']);
        $this->assertSame('array', $result['store']);
        $this->assertArrayHasKey('latency_ms', $result);
        $this->assertGreaterThanOrEqual(0, $result['latency_ms']);
    }

    public function test_it_reports_an_unavailable_store_without_throwing(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 0,
        ]);

        $result = app(CacheHealthCheck::class)->check(force: true);

        $this->assertFalse($result['available']);
        $this->assertSame('unknown', $result['driver']);
        $this->assertSame('missing-store', $result['store']);
        $this->assertArrayHasKey('message', $result);
    }

    public function test_it_reuses_the_last_result_inside_the_configured_interval(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 300,
        ]);

        $healthCheck = app(CacheHealthCheck::class);
        $firstResult = $healthCheck->check(force: true);

        config(['cache.default' => 'missing-store']);

        $cachedResult = $healthCheck->check();
        $forcedResult = $healthCheck->check(force: true);

        $this->assertTrue($cachedResult['available']);
        $this->assertSame($firstResult['store'], $cachedResult['store']);
        $this->assertFalse($forcedResult['available']);
    }

    public function test_it_marks_health_check_as_skipped_when_disabled(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_enabled' => false,
        ]);

        $result = app(CacheHealthCheck::class)->check(force: true);

        $this->assertTrue($result['available']);
        $this->assertTrue($result['skipped']);
        $this->assertSame('missing-store', $result['store']);
    }
}
