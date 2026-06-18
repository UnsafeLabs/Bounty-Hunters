<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    public function database(): JsonResponse
    {
        $connectionName = (string) config('database.default');
        $driver = (string) config("database.connections.{$connectionName}.driver", 'unknown');
        $startedAt = hrtime(true);
        $lastError = null;

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                DB::connection($connectionName)->getPdo();

                return response()->json([
                    'status' => 'ok',
                    'driver' => $driver,
                    'latency_ms' => $this->latencySince($startedAt),
                    'connection_name' => $connectionName,
                    'attempts' => $attempt,
                ]);
            } catch (Throwable $throwable) {
                $lastError = $throwable;

                if ($attempt < 3) {
                    usleep(500_000);
                }
            }
        }

        return response()->json([
            'status' => 'error',
            'driver' => $driver,
            'latency_ms' => $this->latencySince($startedAt),
            'connection_name' => $connectionName,
            'attempts' => 3,
            'error' => $lastError?->getMessage(),
        ], 503);
    }

    private function latencySince(int $startedAt): float
    {
        return round((hrtime(true) - $startedAt) / 1_000_000, 2);
    }
}
