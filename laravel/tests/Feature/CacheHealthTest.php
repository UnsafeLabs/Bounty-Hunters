<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Tests\TestCase;

class CacheHealthTest extends TestCase
{
    /**
     * Test health check endpoint returns success when cache is available.
     */
    public function test_health_check_endpoint_returns_success_when_cache_is_available()
    {
        Cache::shouldReceive('put')->once()->andReturn(true);
        Cache::shouldReceive('get')->once()->andReturn(true);
        Cache::shouldReceive('forget')->once()->andReturn(true);
        Config::set('cache.default', 'file');
        Config::set('cache.health_check_enabled', true);

        $response = $this->get('/health/cache');

        $response->assertStatus(200)
                 ->assertJsonStructure(['available', 'driver', 'latency_ms'])
                 ->assertJson(['available' => true, 'driver' => 'file']);
    }

    /**
     * Test health check endpoint returns 503 when cache is unavailable.
     */
    public function test_health_check_endpoint_returns_503_when_cache_is_unavailable()
    {
        Cache::shouldReceive('put')->once()->andThrow(new \Exception('Connection failed'));
        Cache::shouldReceive('forget')->once()->andReturn(true);
        Config::set('cache.default', 'redis');
        Config::set('cache.health_check_enabled', true);

        $response = $this->get('/health/cache');

        $response->assertStatus(503)
                 ->assertJson(['available' => false, 'driver' => 'redis']);
    }

    /**
     * Test health check endpoint returns 404 when disabled.
     */
    public function test_health_check_endpoint_returns_404_when_disabled()
    {
        Config::set('cache.health_check_enabled', false);

        $response = $this->get('/health/cache');

        $response->assertStatus(404);
    }

    /**
     * Test cache status command outputs correctly.
     */
    public function test_cache_status_command_outputs_correctly()
    {
        Cache::shouldReceive('put')->andReturn(true);
        Cache::shouldReceive('get')->andReturn(true);
        Cache::shouldReceive('forget')->andReturn(true);
        Config::set('cache.default', 'file');

        $this->artisan('cache:status')
             ->expectsOutput('Running cache health check...')
             ->assertExitCode(0);
    }
}

