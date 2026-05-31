<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {--force : Ignore the cached health-check result}';

    protected $description = 'Display the configured cache store health status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $result = $healthCheck->check((bool) $this->option('force'));

        $this->table(
            ['Driver', 'Available', 'Latency (ms)'],
            [[
                $result['driver'],
                $result['available'] ? 'yes' : 'no',
                (string) $result['latency_ms'],
            ]]
        );

        if (! $result['checked']) {
            $this->warn('Cache health checks are disabled by configuration.');
        }

        if (! $result['available']) {
            $this->error($result['error'] ?? 'Cache store is unavailable.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
