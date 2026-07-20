<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {--store= : Optional cache store name}';

    protected $description = 'Run a cache store health check and print driver, availability, latency';

    public function handle(CacheHealthCheck $health): int
    {
        $store = $this->option('store') ?: null;
        $result = $health->check($store);

        $this->table(
            ['Field', 'Value'],
            [
                ['driver', $result['driver']],
                ['available', $result['available'] ? 'yes' : 'no'],
                ['latency_ms', (string) $result['latency_ms']],
                ['error', $result['error'] ?? ''],
            ]
        );

        return $result['available'] ? self::SUCCESS : self::FAILURE;
    }
}
