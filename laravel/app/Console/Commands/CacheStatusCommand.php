<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status {store?}';

    protected $description = 'Show cache store health status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $status = $healthCheck->check($this->argument('store'));

        $this->table(
            ['Driver', 'Available', 'Latency (ms)'],
            [[
                $status['driver'],
                $status['available'] ? 'yes' : 'no',
                $status['latency_ms'],
            ]]
        );

        if (! $status['available'] && isset($status['error'])) {
            $this->error($status['error']);
        }

        return $status['available'] ? self::SUCCESS : self::FAILURE;
    }
}
