<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Cache;

class CacheHealthCheckTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
    }

    public function test_cache_health_check_returns_available(): void
    {
        Cache::shouldReceive('put')->once()->andReturn(true);
        Cache::shouldReceive('get')->once()->andReturn('ok');
        Cache::shouldReceive('forget')->once()->andReturn(true);

        $healthCheck = new CacheHealthCheck();
        $result = $healthCheck->check();

        $this->assertTrue($result['available']);
        $this->assertArrayHasKey('driver', $result);
        $this->assertArrayHasKey('latency_ms', $result);
    }

    public function test_cache_health_check_handles_failure(): void
    {
        Cache::shouldReceive('put')->andThrow(new \RuntimeException('Connection refused'));

        $healthCheck = new CacheHealthCheck();
        $result = $healthCheck->check();

        $this->assertFalse($result['available']);
        $this->assertArrayHasKey('error', $result);
    }

    public function test_health_endpoint_returns_200_when_healthy(): void
    {
        $this->app->instance(CacheHealthCheck::class, new class extends CacheHealthCheck {
            public function check(): array
            {
                return ['available' => true, 'driver' => 'file', 'latency_ms' => 1.5];
            }
        });

        $response = $this->getJson('/api/health/cache');

        $response->assertStatus(200);
        $response->assertJson(['available' => true]);
    }

    public function test_health_endpoint_returns_503_when_unhealthy(): void
    {
        $this->app->instance(CacheHealthCheck::class, new class extends CacheHealthCheck {
            public function check(): array
            {
                return ['available' => false, 'driver' => 'redis', 'latency_ms' => 5000, 'error' => 'Connection refused'];
            }
        });

        $response = $this->getJson('/api/health/cache');

        $response->assertStatus(503);
        $response->assertJson(['available' => false]);
    }

    public function test_cache_status_command_succeeds_when_healthy(): void
    {
        $this->app->instance(CacheHealthCheck::class, new class extends CacheHealthCheck {
            public function check(): array
            {
                return ['available' => true, 'driver' => 'file', 'latency_ms' => 1.0];
            }
        });

        $this->artisan('cache:status')->assertSuccessful();
    }

    public function test_cache_status_command_fails_when_unhealthy(): void
    {
        $this->app->instance(CacheHealthCheck::class, new class extends CacheHealthCheck {
            public function check(): array
            {
                return ['available' => false, 'driver' => 'redis', 'latency_ms' => 5000, 'error' => 'Connection refused'];
            }
        });

        $this->artisan('cache:status')->assertFailed();
    }
}
