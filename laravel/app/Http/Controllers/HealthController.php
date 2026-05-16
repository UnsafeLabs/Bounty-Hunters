<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    private const MAX_ATTEMPTS = 3;
    private const RETRY_DELAY_MS = 500;

    public function database(): JsonResponse
    {
        $connectionName = (string) config('database.default');
        $driver = config("database.connections.{$connectionName}.driver");
        $startedAt = microtime(true);
        $lastException = null;
        $retryDelayMs = (int) config('database.health_check.retry_delay_ms', self::RETRY_DELAY_MS);

        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            try {
                $connection = DB::connection($connectionName);
                $connection->select('select 1');

                return response()->json([
                    'status' => 'healthy',
                    'driver' => $connection->getDriverName(),
                    'latency_ms' => $this->elapsedMilliseconds($startedAt),
                    'connection_name' => $connectionName,
                ]);
            } catch (Throwable $exception) {
                $lastException = $exception;

                if ($attempt < self::MAX_ATTEMPTS) {
                    usleep(max(0, $retryDelayMs) * 1000);
                }
            }
        }

        return response()->json([
            'status' => 'unhealthy',
            'driver' => $driver,
            'latency_ms' => $this->elapsedMilliseconds($startedAt),
            'connection_name' => $connectionName,
            'error' => $lastException?->getMessage(),
        ], 503);
    }

    private function elapsedMilliseconds(float $startedAt): float
    {
        return round((microtime(true) - $startedAt) * 1000, 2);
    }
}
