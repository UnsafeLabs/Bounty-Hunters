<?php

namespace Tests\Feature;

use Tests\TestCase;

class CacheStatusCommandTest extends TestCase
{
    public function test_cache_status_command_outputs_health_table(): void
    {
        config(['cache.default' => 'array']);

        $this->artisan('cache:status')
            ->assertExitCode(0);
    }
}
