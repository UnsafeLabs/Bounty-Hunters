<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    private const MAX_ATTEMPTS = 3;

    private const RETRY_DELAY_MICROSECONDS = 500_000;

    public function database(): JsonResponse
    {
        $connectionName = config('database.default');
        $driver = config("database.connections.{$connectionName}.driver");
        $startedAt = hrtime(true);
        $lastError = null;

        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            try {
                $connection = DB::connection($connectionName);
                $connection->getPdo();

                return response()->json([
                    'status' => 'ok',
                    'driver' => $connection->getDriverName(),
                    'latency_ms' => $this->elapsedMilliseconds($startedAt),
                    'connection_name' => $connectionName,
                    'attempts' => $attempt,
                ]);
            } catch (Throwable $exception) {
                $lastError = $exception;
                DB::purge($connectionName);

                if ($attempt < self::MAX_ATTEMPTS) {
                    usleep(self::RETRY_DELAY_MICROSECONDS);
                }
            }
        }

        return response()->json([
            'status' => 'error',
            'driver' => $driver,
            'latency_ms' => $this->elapsedMilliseconds($startedAt),
            'connection_name' => $connectionName,
            'attempts' => self::MAX_ATTEMPTS,
            'error' => $lastError?->getMessage() ?? 'Database connection failed.',
        ], 503);
    }

    private function elapsedMilliseconds(int $startedAt): float
    {
        return round((hrtime(true) - $startedAt) / 1_000_000, 2);
    }
}
