<?php

namespace Tests\Unit;

use App\Services\CacheHealthCheck;
use Illuminate\Config\Repository;
use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class CacheHealthCheckTest extends TestCase
{
    public function test_it_reports_the_active_cache_store_as_available(): void
    {
        config()->set('cache.default', 'array');

        $result = app(CacheHealthCheck::class)->check(force: true);

        $this->assertTrue($result['available']);
        $this->assertTrue($result['checked']);
        $this->assertFalse($result['cached']);
        $this->assertSame('array', $result['driver']);
        $this->assertIsFloat($result['latency_ms']);
    }

    public function test_it_respects_disabled_health_checks(): void
    {
        $config = new Repository([
            'cache' => [
                'default' => 'missing-store',
                'health_check_enabled' => false,
                'stores' => [
                    'missing-store' => [
                        'driver' => 'missing',
                    ],
                ],
            ],
        ]);

        $cache = Mockery::mock(CacheFactory::class);
        $cache->shouldNotReceive('store');

        $result = (new CacheHealthCheck($cache, $config))->check();

        $this->assertTrue($result['available']);
        $this->assertFalse($result['checked']);
        $this->assertSame('missing', $result['driver']);
        $this->assertSame(0.0, $result['latency_ms']);
    }

    public function test_it_reuses_a_fresh_result_for_the_configured_interval(): void
    {
        $config = new Repository([
            'cache' => [
                'default' => 'array',
                'health_check_enabled' => true,
                'health_check_interval' => 300,
                'stores' => [
                    'array' => [
                        'driver' => 'array',
                    ],
                ],
            ],
        ]);

        $storedValue = null;
        $store = Mockery::mock();
        $store->shouldReceive('put')
            ->once()
            ->withArgs(function (string $key, string $value, int $ttl) use (&$storedValue): bool {
                $storedValue = $value;

                return str_starts_with($key, 'health:cache:') && $ttl === 30;
            })
            ->andReturnTrue();
        $store->shouldReceive('get')->once()->andReturnUsing(function () use (&$storedValue): ?string {
            return $storedValue;
        });
        $store->shouldReceive('forget')->once()->andReturnTrue();

        $cache = Mockery::mock(CacheFactory::class);
        $cache->shouldReceive('store')->once()->with('array')->andReturn($store);

        $service = new CacheHealthCheck($cache, $config);

        $first = $service->check();
        $second = $service->check();

        $this->assertTrue($first['available']);
        $this->assertFalse($first['cached']);
        $this->assertTrue($second['available']);
        $this->assertTrue($second['cached']);
    }

    public function test_it_reports_unavailable_when_the_store_throws(): void
    {
        $config = new Repository([
            'cache' => [
                'default' => 'redis',
                'health_check_enabled' => true,
                'stores' => [
                    'redis' => [
                        'driver' => 'redis',
                    ],
                ],
            ],
        ]);

        $cache = Mockery::mock(CacheFactory::class);
        $cache->shouldReceive('store')->once()->with('redis')->andThrow(new RuntimeException('redis offline'));

        $result = (new CacheHealthCheck($cache, $config))->check();

        $this->assertFalse($result['available']);
        $this->assertTrue($result['checked']);
        $this->assertSame('redis', $result['driver']);
        $this->assertSame('redis offline', $result['error']);
        $this->assertIsFloat($result['latency_ms']);
    }
}
