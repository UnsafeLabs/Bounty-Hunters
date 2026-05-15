<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    /**
     * Test the check method returns available true on success.
     */
    public function test_check_returns_available_true_on_success()
    {
        Cache::shouldReceive('put')->once()->andReturn(true);
        Cache::shouldReceive('get')->once()->andReturn(true);
        Cache::shouldReceive('forget')->once()->andReturn(true);
        Config::set('cache.default', 'file');

        $service = new CacheHealthCheck();
        $results = $service->check();

        $this->assertTrue($results['available']);
        $this->assertEquals('file', $results['driver']);
        $this->assertIsFloat($results['latency_ms']);
    }

    /**
     * Test the check method returns available false on failure.
     */
    public function test_check_returns_available_false_on_failure()
    {
        Cache::shouldReceive('put')->once()->andThrow(new \Exception('Fail'));
        Cache::shouldReceive('forget')->once()->andReturn(true);
        Config::set('cache.default', 'redis');

        $service = new CacheHealthCheck();
        $results = $service->check();

        $this->assertFalse($results['available']);
        $this->assertEquals('redis', $results['driver']);
    }
}

