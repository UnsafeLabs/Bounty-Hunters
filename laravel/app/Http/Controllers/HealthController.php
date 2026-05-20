<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    public function database(): JsonResponse
    {
        $connectionName = DB::getDefaultConnection();
        $startedAt = microtime(true);
        $lastError = null;

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                $connection = DB::connection($connectionName);
                $connection->getPdo();

                return response()->json([
                    'status' => 'ok',
                    'driver' => $connection->getDriverName(),
                    'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
                    'connection_name' => $connectionName,
                ]);
            } catch (Throwable $exception) {
                $lastError = $exception;

                if ($attempt < 3) {
                    usleep(500_000);
                }
            }
        }

        return response()->json([
            'status' => 'error',
            'driver' => config("database.connections.{$connectionName}.driver"),
            'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
            'connection_name' => $connectionName,
            'error' => $lastError?->getMessage(),
        ], 503);
    }
}
