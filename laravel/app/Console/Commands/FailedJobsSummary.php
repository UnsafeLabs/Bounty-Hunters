<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class FailedJobsSummary extends Command
{
    protected $signature = 'jobs:failed-summary';
    protected $description = 'Show summary of failed jobs in the last 24 hours';

    public function handle(): int
    {
        $keys = Cache::getStore()->getCachePrefix() . 'failed_jobs:*';

        $failedJobs = [];
        $connection = config('cache.default');

        if ($connection === 'database' || $connection === 'file') {
            $this->info('Failed job tracking is stored in cache. Checking known job names...');
        }

        $allKeys = Cache::get('failed_jobs_registry', []);

        if (empty($allKeys)) {
            $this->info('No failed jobs recorded in the last 24 hours.');
            return Command::SUCCESS;
        }

        $this->table(
            ['Job Name', 'Failures (24h)'],
            array_map(fn($name) => [$name, Cache::get('failed_jobs:' . $name, 0)], $allKeys)
        );

        return Command::SUCCESS;
    }
}
