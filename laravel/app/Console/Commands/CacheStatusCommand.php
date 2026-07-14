<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {store? : The cache store to check}';
    protected $description = 'Check the health of the configured cache store';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $store = $this->argument('store');
        $result = $healthCheck->check($store);

        $this->info('Cache Health Status');
        $this->table(
            ['Key', 'Value'],
            [
                ['Available', $result['available'] ? '<info>YES</info>' : '<error>NO</error>'],
                ['Driver', $result['driver']],
                ['Store', $result['store']],
                ['Latency (ms)', $result['latency_ms']],
            ]
        );

        return $result['available'] ? self::SUCCESS : self::FAILURE;
    }
}
