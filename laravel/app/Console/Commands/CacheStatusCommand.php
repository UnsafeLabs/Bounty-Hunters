<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {store? : Cache store to check}';

    protected $description = 'Check cache store availability and latency';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $status = $healthCheck->check($this->argument('store'));

        $this->line('Driver: '.$status['driver']);
        $this->line('Available: '.($status['available'] ? 'yes' : 'no'));
        $this->line('Latency: '.$status['latency_ms'].'ms');

        if (isset($status['message'])) {
            $this->line('Message: '.$status['message']);
        }

        return $status['available'] ? self::SUCCESS : self::FAILURE;
    }
}
