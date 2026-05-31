<?php

namespace Tests\Feature;

use App\Services\CacheHealthCheck;
use Illuminate\Support\Facades\Artisan;
use Mockery;
use Tests\TestCase;

class CacheStatusCommandTest extends TestCase
{
    public function test_cache_status_command_outputs_driver_availability_and_latency(): void
    {
        $healthCheck = Mockery::mock(CacheHealthCheck::class);
        $healthCheck->shouldReceive('check')->once()->with(false)->andReturn([
            'available' => true,
            'driver' => 'array',
            'latency_ms' => 1.25,
            'store' => 'array',
            'checked' => true,
            'cached' => false,
        ]);

        $this->app->instance(CacheHealthCheck::class, $healthCheck);

        $exitCode = Artisan::call('cache:status');
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('Driver', $output);
        $this->assertStringContainsString('Available', $output);
        $this->assertStringContainsString('Latency (ms)', $output);
        $this->assertStringContainsString('array', $output);
        $this->assertStringContainsString('yes', $output);
        $this->assertStringContainsString('1.25', $output);
    }

    public function test_cache_status_command_returns_failure_when_cache_is_unavailable(): void
    {
        $healthCheck = Mockery::mock(CacheHealthCheck::class);
        $healthCheck->shouldReceive('check')->once()->with(true)->andReturn([
            'available' => false,
            'driver' => 'redis',
            'latency_ms' => 4.5,
            'store' => 'redis',
            'checked' => true,
            'cached' => false,
            'error' => 'redis offline',
        ]);

        $this->app->instance(CacheHealthCheck::class, $healthCheck);

        $exitCode = Artisan::call('cache:status', ['--force' => true]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('redis', $output);
        $this->assertStringContainsString('no', $output);
        $this->assertStringContainsString('redis offline', $output);
    }
}
