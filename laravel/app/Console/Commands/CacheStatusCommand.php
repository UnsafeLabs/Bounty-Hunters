<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status';

    protected $description = 'Check cache store health and display connection status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $result = $healthCheck->check();

        $this->info("Cache Driver: {$result['driver']}");
        $this->info("Available: " . ($result['available'] ? 'Yes' : 'No'));
        $this->info("Latency: {$result['latency_ms']}ms");

        if (!$result['available']) {
            $this->error('Cache store is not available!');
            if (isset($result['error'])) {
                $this->error("Error: {$result['error']}");
            }
            return self::FAILURE;
        }

        $this->info('Cache store is healthy.');
        return self::SUCCESS;
    }
}
