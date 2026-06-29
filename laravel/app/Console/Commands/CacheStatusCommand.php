<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status';

    protected $description = 'Display active cache store health status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $status = $healthCheck->check();

        $this->line('Cache driver: '.$status['driver']);
        $this->line('Available: '.($status['available'] ? 'yes' : 'no'));
        $this->line('Latency: '.$status['latency_ms'].' ms');
        $this->line('Health check enabled: '.($status['enabled'] ? 'yes' : 'no'));
        $this->line('Health check interval: '.$status['interval'].' seconds');

        if (! $status['available'] && isset($status['error'])) {
            $this->error('Error: '.$status['error']);
        }

        return $status['available'] ? self::SUCCESS : self::FAILURE;
    }
}
