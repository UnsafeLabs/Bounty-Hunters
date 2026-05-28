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
    protected $description = 'Check the health status of all configured cache stores';

    protected CacheHealthCheck $healthCheck;

    public function __construct(CacheHealthCheck $healthCheck)
    {
        parent::__construct();
        $this->healthCheck = $healthCheck;
    }

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $this->info('Cache Health Status');
        $this->line(str_repeat('─', 60));

        $results = $this->healthCheck->checkAll();
        $allHealthy = true;

        foreach ($results as $store => $status) {
            $available = $status['available'] ? '✓ Available' : '✗ Unavailable';
            $latency = $status['latency_ms'] !== null ? sprintf('%.2f ms', $status['latency_ms']) : 'N/A';
            $driver = $status['driver'];

            if (!$status['available']) {
                $allHealthy = false;
            }

            $this->table(
                [$store],
                [[
                    'Status' => $available,
                    'Driver' => $driver,
                    'Latency' => $latency,
                    'Error' => $status['error'] ?? '—',
                ]]
            );
        }

        $this->line(str_repeat('─', 60));

        if ($allHealthy) {
            $this->info('All cache stores are healthy.');
            return Command::SUCCESS;
        }

        $this->error('Some cache stores are unhealthy.');
        return Command::FAILURE;
    }
}
