<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class CacheStatusCommandTest extends TestCase
{
    public function test_cache_status_command_outputs_driver_availability_and_latency(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 0,
        ]);

        $exitCode = Artisan::call('cache:status', ['--force' => true]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('Driver: array', $output);
        $this->assertStringContainsString('Available: yes', $output);
        $this->assertStringContainsString('Latency:', $output);
    }

    public function test_cache_status_command_fails_when_store_is_unavailable(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 0,
        ]);

        $exitCode = Artisan::call('cache:status', ['--force' => true]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('Driver: unknown', $output);
        $this->assertStringContainsString('Available: no', $output);
    }
}
