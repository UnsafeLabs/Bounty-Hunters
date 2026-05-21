<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    public function database(): JsonResponse
    {
        $connectionName = config('database.default');
        $connection = DB::connection($connectionName);
        $driver = $connection->getDriverName();
        $startedAt = microtime(true);
        $lastError = null;

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                $connection->disconnect();
                $connection->select('select 1');

                return response()->json([
                    'status' => 'ok',
                    'driver' => $driver,
                    'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
                    'connection_name' => $connectionName,
                ]);
            } catch (Throwable $exception) {
                $lastError = $exception;

                if ($attempt < 3) {
                    usleep(500000);
                }
            }
        }

        return response()->json([
            'status' => 'error',
            'driver' => $driver,
            'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
            'connection_name' => $connectionName,
            'error' => $lastError?->getMessage(),
        ], 503);
    }
}
