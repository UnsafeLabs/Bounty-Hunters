<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'cache:status';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Display the health status of the active cache store';

    /**
     * Execute the console command.
     */
    public function handle(CacheHealthCheck $healthCheck): int
    {
        $result = $healthCheck->check();

        $status = $result['available'] ? '<fg=green>Available</>' : '<fg=red>Unavailable</>';
        $latency = $result['latency_ms'];

        $this->info("Cache Driver: {$result['driver']}");
        $this->info("Status: {$status}");
        $this->info("Latency: {$latency}ms");

        return $result['available'] ? Command::SUCCESS : Command::FAILURE;
    }
}
