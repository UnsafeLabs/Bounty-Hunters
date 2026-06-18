<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {--force : Bypass the cached health result}';

    protected $description = 'Report availability for the configured cache store.';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $result = $healthCheck->check((bool) $this->option('force'));

        $this->line(sprintf('Driver: %s', $result['driver']));
        $this->line(sprintf('Store: %s', $result['store']));
        $this->line(sprintf('Available: %s', $result['available'] ? 'yes' : 'no'));
        $this->line(sprintf('Latency: %.2f ms', $result['latency_ms']));

        if (($result['skipped'] ?? false) === true) {
            $this->warn($result['message'] ?? 'Cache health checks are disabled.');
        } elseif (! $result['available'] && isset($result['message'])) {
            $this->error($result['message']);
        }

        return $result['available'] ? self::SUCCESS : self::FAILURE;
    }
}
