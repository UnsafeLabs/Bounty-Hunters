<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    public function database(): JsonResponse
    {
        $connectionName = DB::getDefaultConnection();
        $driver = Config::get("database.connections.{$connectionName}.driver");
        $startedAt = hrtime(true);
        $lastError = null;

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                DB::connection($connectionName)->getPdo();

                return response()->json([
                    'status' => 'ok',
                    'driver' => $driver,
                    'latency_ms' => $this->elapsedMilliseconds($startedAt),
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
            'driver' => $driver,
            'latency_ms' => $this->elapsedMilliseconds($startedAt),
            'connection_name' => $connectionName,
            'error' => $lastError?->getMessage(),
        ], 503);
    }

    private function elapsedMilliseconds(int $startedAt): float
    {
        return round((hrtime(true) - $startedAt) / 1_000_000, 2);
    }
}
