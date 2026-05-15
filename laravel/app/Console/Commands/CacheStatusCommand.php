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
    protected $description = 'Run the cache health check and display results';

    /**
     * Execute the console command.
     *
     * @param  \App\Services\CacheHealthCheck  $healthCheck
     * @return int
     */
    public function handle(CacheHealthCheck $healthCheck)
    {
        $this->info('Running cache health check...');

        $results = $healthCheck->check();

        $this->table(
            ['Field', 'Value'],
            [
                ['Driver', $results['driver']],
                ['Available', $results['available'] ? 'Yes' : 'No'],
                ['Latency (ms)', $results['latency_ms']],
            ]
        );

        if (!$results['available']) {
            $this->error('Cache store is unavailable!');
            return 1;
        }

        $this->info('Cache store is healthy.');
        return 0;
    }
}

