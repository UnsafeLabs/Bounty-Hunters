<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'cache:status {--fresh : Bypass the health check interval and probe the store now}';

    /**
     * @var string
     */
    protected $description = 'Report the availability and latency of the active cache store';

    public function handle(CacheHealthCheck $health): int
    {
        if (! $health->isEnabled()) {
            $this->components->warn('Cache health checks are disabled (cache.health_check_enabled = false).');

            return self::SUCCESS;
        }

        $result = $health->check((bool) $this->option('fresh'));

        $this->components->twoColumnDetail('Driver', $result['driver']);
        $this->components->twoColumnDetail('Available', $result['available'] ? 'yes' : 'no');
        $this->components->twoColumnDetail(
            'Latency',
            $result['latency_ms'] !== null ? $result['latency_ms'].' ms' : 'n/a'
        );

        return $result['available'] ? self::SUCCESS : self::FAILURE;
    }
}
