<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    private const MAX_ATTEMPTS = 3;
    private const RETRY_DELAY_MICROSECONDS = 500000;

    public function database(): JsonResponse
    {
        $connectionName = config('database.default');
        $connection = DB::connection($connectionName);
        $driver = $connection->getDriverName();
        $startedAt = hrtime(true);
        $lastException = null;

        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            try {
                $connection->getPdo();

                return response()->json([
                    'status' => 'ok',
                    'driver' => $driver,
                    'latency_ms' => $this->elapsedMilliseconds($startedAt),
                    'connection_name' => $connectionName,
                ]);
            } catch (Throwable $exception) {
                $lastException = $exception;
                DB::purge($connectionName);
                $connection = DB::connection($connectionName);

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
            'error' => $lastException?->getMessage() ?? 'Database connection failed.',
        ], 503);
    }

    private function elapsedMilliseconds(int $startedAt): float
    {
        return round((hrtime(true) - $startedAt) / 1_000_000, 2);
    }
}
