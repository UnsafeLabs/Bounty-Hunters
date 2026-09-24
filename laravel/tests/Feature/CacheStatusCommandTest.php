<?php

namespace Tests\Feature;

use Tests\TestCase;

class CacheStatusCommandTest extends TestCase
{
    private function configureBrokenStore(): void
    {
        config([
            'cache.default' => 'broken',
            'cache.stores.broken' => [
                'driver' => 'redis',
                'connection' => 'does-not-exist',
            ],
        ]);
    }

    public function test_command_reports_available_store(): void
    {
        config(['cache.default' => 'array']);

        $this->artisan('cache:status')
            ->expectsOutputToContain('array')
            ->expectsOutputToContain('yes')
            ->assertExitCode(0);
    }

    public function test_command_fails_when_store_is_unavailable(): void
    {
        $this->configureBrokenStore();

        $this->artisan('cache:status')
            ->expectsOutputToContain('broken')
            ->expectsOutputToContain('no')
            ->assertExitCode(1);
    }

    public function test_command_reports_when_health_checks_are_disabled(): void
    {
        config(['cache.health_check_enabled' => false]);

        $this->artisan('cache:status')
            ->expectsOutputToContain('disabled')
            ->assertExitCode(0);
    }
}
