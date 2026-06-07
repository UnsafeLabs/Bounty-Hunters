<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_reports_available_cache_store(): void
    {
        config()->set('cache.default', 'array');

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertArrayHasKey('latency_ms', $status);
    }

    public function test_reports_unavailable_store_when_connection_fails(): void
    {
        $status = app(CacheHealthCheck::class)->check('missing-store');

        $this->assertFalse($status['available']);
        $this->assertSame('missing-store', $status['driver']);
        $this->assertArrayHasKey('latency_ms', $status);
        $this->assertArrayHasKey('message', $status);
    }

    public function test_respects_disabled_health_check_config(): void
    {
        config()->set('cache.default', 'array');
        config()->set('cache.health_check_enabled', false);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('disabled', $status['message']);
    }
}
