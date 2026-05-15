<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class DatabaseHealthCheck
{
    private int $retryAttempts;
    private int $retryDelayMs;

    public function __construct(int $retryAttempts = 3, int $retryDelayMs = 1000)
    {
        $this->retryAttempts = $retryAttempts;
        $this->retryDelayMs = $retryDelayMs;
    }

    public function check(): array
    {
        $start = microtime(true);

        try {
            DB::connection()->getPdo();
            $latency = round((microtime(true) - $start) * 1000, 2);

            $driver = DB::connection()->getDriverName();
            $database = DB::connection()->getDatabaseName();

            return [
                'status' => 'healthy',
                'driver' => $driver,
                'database' => $database,
                'latency_ms' => $latency,
                'timestamp' => now()->toIso8601String(),
            ];
        } catch (\Throwable $e) {
            $latency = round((microtime(true) - $start) * 1000, 2);

            return [
                'status' => 'unhealthy',
                'error' => $e->getMessage(),
                'latency_ms' => $latency,
                'timestamp' => now()->toIso8601String(),
            ];
        }
    }

    public function checkWithRetry(): array
    {
        $lastResult = null;

        for ($attempt = 1; $attempt <= $this->retryAttempts; $attempt++) {
            $lastResult = $this->check();

            if ($lastResult['status'] === 'healthy') {
                $lastResult['attempts'] = $attempt;
                return $lastResult;
            }

            Log::warning("Database health check attempt {$attempt} failed", [
                'error' => $lastResult['error'] ?? 'unknown',
            ]);

            if ($attempt < $this->retryAttempts) {
                usleep($this->retryDelayMs * 1000);
            }
        }

        $lastResult['attempts'] = $this->retryAttempts;
        return $lastResult;
    }
}
