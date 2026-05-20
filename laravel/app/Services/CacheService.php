<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;

class CacheService
{
    protected array $stores;
    protected string $defaultStore;

    public function __construct()
    {
        $this->defaultStore = Config::get('cache.default', 'file');
        $this->stores = Config::get('cache.stores', []);
    }

    public function remember(string $key, callable $callback, int $ttl = 3600): mixed
    {
        if (Cache::has($key)) {
            return Cache::get($key);
        }

        $value = $callback();
        Cache::put($key, $value, $ttl);
        return $value;
    }

    public function rememberForever(string $key, callable $callback): mixed
    {
        return Cache::rememberForever($key, $callback);
    }

    public function tags(array $tags): static
    {
        if (in_array($this->defaultStore, ['redis', 'memcached'])) {
            Cache::tags($tags);
        }
        return $this;
    }

    public function flush(string $tag = null): void
    {
        if ($tag) {
            if (in_array($this->defaultStore, ['redis', 'memcached'])) {
                Cache::tags([$tag])->flush();
            }
        } else {
            Cache::flush();
        }
    }

    public function warmup(array $keys, callable $generator): void
    {
        foreach ($keys as $key => $ttl) {
            $value = $generator($key);
            Cache::put($key, $value, $ttl);
        }
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return Cache::get($key, $default);
    }

    public function put(string $key, mixed $value, int $ttl = 3600): bool
    {
        return Cache::put($key, $value, $ttl);
    }

    public function forget(string $key): bool
    {
        return Cache::forget($key);
    }

    public function getMultiple(array $keys): array
    {
        $result = [];
        foreach ($keys as $key) {
            $result[$key] = $this->get($key);
        }
        return $result;
    }

    public function putMultiple(array $items, int $ttl = 3600): void
    {
        foreach ($items as $key => $value) {
            $this->put($key, $value, $ttl);
        }
    }
}
