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
    protected $description = 'Display the current cache store status and health';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $healthCheck = new CacheHealthCheck();
        $result = $healthCheck->check();

        $this->newLine();
        $this->info('Cache Status');
        $this->info('============');

        $this->table(
            ['Property', 'Value'],
            [
                ['Driver', $result['driver']],
                ['Available', $result['available'] ? 'Yes' : 'No'],
                ['Latency', $result['latency_ms'] . ' ms'],
            ]
        );

        if (!$result['available']) {
            $this->newLine();
            $this->error('Cache is currently unavailable!');
            return self::FAILURE;
        }

        $this->newLine();
        $this->info('Cache is healthy.');

        return self::SUCCESS;
    }
}