<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_array_cache_store_reports_available(): void
    {
        config(['cache.default' => 'array']);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertArrayHasKey('latency_ms', $status);
    }
}
