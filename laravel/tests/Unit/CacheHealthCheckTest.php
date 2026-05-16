<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Mockery;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_reports_available_active_cache_store(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_interval' => 0,
        ]);

        $status = $this->app->make(CacheHealthCheck::class)->check(force: true);

        $this->assertTrue($status['available']);
        $this->assertSame('array', $status['driver']);
        $this->assertGreaterThanOrEqual(0, $status['latency_ms']);
    }

    public function test_reports_unavailable_when_active_cache_store_is_not_configured(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_interval' => 0,
        ]);

        $status = $this->app->make(CacheHealthCheck::class)->check(force: true);

        $this->assertFalse($status['available']);
        $this->assertSame('unknown', $status['driver']);
        $this->assertGreaterThanOrEqual(0, $status['latency_ms']);
    }

    public function test_respects_disabled_health_check_config(): void
    {
        config([
            'cache.default' => 'missing-store',
            'cache.health_check_enabled' => false,
            'cache.health_check_interval' => 0,
        ]);

        $status = $this->app->make(CacheHealthCheck::class)->check(force: true);

        $this->assertTrue($status['available']);
        $this->assertSame('unknown', $status['driver']);
        $this->assertSame(0.0, $status['latency_ms']);
    }

    public function test_reuses_cached_status_within_configured_interval(): void
    {
        config([
            'cache.default' => 'array',
            'cache.health_check_enabled' => true,
            'cache.health_check_interval' => 300,
        ]);

        $writtenValue = null;
        $repository = Mockery::mock(CacheRepository::class);
        $repository->shouldReceive('put')
            ->once()
            ->andReturnUsing(function (string $key, string $value, int $seconds) use (&$writtenValue): bool {
                $writtenValue = $value;

                return $seconds === 10;
            });
        $repository->shouldReceive('get')
            ->once()
            ->andReturnUsing(fn (string $key): ?string => $writtenValue);
        $repository->shouldReceive('forget')
            ->once()
            ->andReturn(true);

        $cache = Mockery::mock(CacheFactory::class);
        $cache->shouldReceive('store')
            ->once()
            ->with('array')
            ->andReturn($repository);

        $healthCheck = new CacheHealthCheck($cache, $this->app['config']);

        $first = $healthCheck->check(force: true);
        $second = $healthCheck->check();

        $this->assertSame($first, $second);
        $this->assertTrue($second['available']);
        $this->assertSame('array', $second['driver']);
    }
}
