<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheHealthCheckCommand extends Command
{
    protected $signature = 'cache:health-check';
    protected $description = 'Check cache store health and availability';

    public function handle(CacheHealthCheck $checker): int
    {
        $result = $checker->check();
        if ($result['available']) {
            $this->info("Cache store '" . $result['driver'] . "' is available");
            $this->info("Latency: " . $result['latency_ms'] . "ms");
            return Command::SUCCESS;
        }
        $this->error("Cache store '" . $result['driver'] . "' is unavailable");
        return Command::FAILURE;
    }
}