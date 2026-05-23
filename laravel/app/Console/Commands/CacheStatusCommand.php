<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status';

    protected $description = 'Display active cache store health status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $status = $healthCheck->check();

        $this->table(
            ['Driver', 'Available', 'Latency (ms)'],
            [[
                $status['driver'],
                $status['available'] ? 'yes' : 'no',
                number_format($status['latency_ms'], 2),
            ]],
        );

        if (! $status['available'] && isset($status['error'])) {
            $this->error($status['error']);
        }

        return $status['available'] ? self::SUCCESS : self::FAILURE;
    }
}
