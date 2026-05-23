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
        $driver = config("database.connections.{$connectionName}.driver");
        $startedAt = microtime(true);
        $lastException = null;

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                DB::connection($connectionName)->getPdo();

                return response()->json([
                    'status' => 'ok',
                    'driver' => $driver,
                    'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
                    'connection_name' => $connectionName,
                ]);
            } catch (Throwable $exception) {
                $lastException = $exception;
                if ($attempt < 3) {
                    usleep(500_000);
                }
            }
        }

        return response()->json([
            'status' => 'error',
            'driver' => $driver,
            'latency_ms' => round((microtime(true) - $startedAt) * 1000, 2),
            'connection_name' => $connectionName,
            'error' => $lastException?->getMessage(),
        ], 503);
    }
}
