<?php

namespace Tests\Feature;

use Tests\TestCase;

class CacheStatusCommandTest extends TestCase
{
    public function test_cache_status_command_outputs_driver_availability_and_latency(): void
    {
        config()->set('cache.default', 'array');

        $this->artisan('cache:status')
            ->expectsOutput('Driver: array')
            ->expectsOutput('Available: yes')
            ->assertSuccessful();
    }
}
