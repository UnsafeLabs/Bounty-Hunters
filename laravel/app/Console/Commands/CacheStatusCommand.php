<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {--force : Bypass the cached health-check result}';

    protected $description = 'Display the active cache store health status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $status = $healthCheck->check((bool) $this->option('force'));
        $available = $status['available'] ? 'available' : 'unavailable';

        $this->line('Driver: '.$status['driver']);
        $this->line('Availability: '.$available);
        $this->line('Latency: '.$status['latency_ms'].' ms');

        return $status['available'] ? self::SUCCESS : self::FAILURE;
    }
}
