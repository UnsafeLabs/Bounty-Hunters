<?php

namespace App\Console\Commands;

use App\Services\DatabaseHealthCheck;
use Illuminate\Console\Command;

class DatabaseStatusCommand extends Command
{
    protected $signature = 'db:health {--retries=3 : Number of retry attempts} {--delay=1000 : Delay between retries in ms}';

    protected $description = 'Check database connection health with optional retries';

    public function handle(DatabaseHealthCheck $healthCheck): int
    {
        $retries = (int) $this->option('retries');
        $delay = (int) $this->option('delay');

        $service = new DatabaseHealthCheck($retries, $delay);
        $result = $service->checkWithRetry();

        if ($result['status'] === 'healthy') {
            $this->info("Database: {$result['database']}");
            $this->info("Driver: {$result['driver']}");
            $this->info("Latency: {$result['latency_ms']}ms");
            $this->info("Attempts: {$result['attempts']}");
            return self::SUCCESS;
        }

        $this->error("Database unhealthy: {$result['error']}");
        $this->error("Attempts: {$result['attempts']}");
        return self::FAILURE;
    }
}
