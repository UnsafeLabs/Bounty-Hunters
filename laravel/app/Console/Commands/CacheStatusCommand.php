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
    protected $description = 'Runs the cache health check and displays results';

    /**
     * Execute the console command.
     */
    public function handle(CacheHealthCheck $healthCheck)
    {
        $this->info('Running Cache Health Check...');
        $results = $healthCheck->check();

        $this->table(
            ['Field', 'Value'],
            [
                ['Driver', $results['driver']],
                ['Available', $results['available'] ? 'YES' : 'NO'],
                ['Latency', $results['latency_ms'] . ' ms'],
            ]
        );

        return $results['available'] ? 0 : 1;
    }
}
