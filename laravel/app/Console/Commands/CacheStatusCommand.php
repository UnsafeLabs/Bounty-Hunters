<?php

namespace App\Console\Commands;

use App\Services\CacheHealthCheck;
use Illuminate\Console\Command;

class CacheStatusCommand extends Command
{
    protected $signature = 'cache:status
        {--store= : Cache store to check instead of the configured default}
        {--force : Ignore the memoized health-check interval}
        {--json : Output the raw status payload as JSON}';

    protected $description = 'Display the configured cache store health status';

    public function handle(CacheHealthCheck $healthCheck): int
    {
        $store = $this->option('store') ?: null;
        $status = $healthCheck->check($store, (bool) $this->option('force'));

        if ($this->option('json')) {
            $this->line(json_encode($status, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        } else {
            $this->line('Driver: '.$status['driver']);
            $this->line('Store: '.$status['store']);
            $this->line('Available: '.($status['available'] ? 'yes' : 'no'));
            $this->line('Latency: '.$status['latency_ms'].' ms');

            if (isset($status['error'])) {
                $this->line('Error: '.$status['error']);
            }

            if (($status['checked'] ?? true) === false) {
                $this->line($status['message']);
            }
        }

        return $status['available'] ? self::SUCCESS : self::FAILURE;
    }
}
