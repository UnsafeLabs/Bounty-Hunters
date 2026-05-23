<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_cache_health_check_reports_active_store_availability(): void
    {
        config()->set('cache.default', 'array');
        config()->set('cache.health_check_enabled', true);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertIsFloat($status['latency_ms']);
        $this->assertGreaterThanOrEqual(0.0, $status['latency_ms']);
    }

    public function test_cache_health_check_respects_disabled_config(): void
    {
        config()->set('cache.default', 'array');
        config()->set('cache.health_check_enabled', false);

        $status = app(CacheHealthCheck::class)->check();

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertSame(0.0, $status['latency_ms']);
        $this->assertSame('disabled', $status['message']);
    }

    public function test_cache_status_command_outputs_driver_and_availability(): void
    {
        config()->set('cache.default', 'array');

        $this->artisan('cache:status')
            ->expectsOutputToContain('Driver')
            ->expectsOutputToContain('Available')
            ->expectsOutputToContain('array')
            ->expectsOutputToContain('yes')
            ->assertExitCode(0);
    }

    public function test_cache_health_endpoint_returns_healthy_json(): void
    {
        config()->set('cache.default', 'array');

        $this->getJson('/health/cache')
            ->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('driver', 'array');
    }

    public function test_cache_health_endpoint_returns_503_when_unavailable(): void
    {
        $this->mock(CacheHealthCheck::class, function ($mock): void {
            $mock->shouldReceive('check')->once()->andReturn([
                'available' => false,
                'driver' => 'redis',
                'latency_ms' => 0.0,
                'error' => 'connection refused',
            ]);
        });

        $this->getJson('/health/cache')
            ->assertStatus(503)
            ->assertJsonPath('available', false)
            ->assertJsonPath('driver', 'redis')
            ->assertJsonPath('error', 'connection refused');
    }

    protected function tearDown(): void
    {
        Cache::store('array')->flush();

        parent::tearDown();
    }
}
