<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    private const MAX_ATTEMPTS = 3;
    private const RETRY_DELAY_US = 500_000; // 500ms

    public function database(): JsonResponse
    {
        $connection = (string) Config::get('database.default', 'sqlite');
        $driver = (string) Config::get("database.connections.{$connection}.driver", $connection);

        $lastError = null;
        $latencyMs = 0.0;

        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            $start = hrtime(true);
            try {
                DB::connection($connection)->select('select 1 as ok');
                $latencyMs = (hrtime(true) - $start) / 1e6;

                return response()->json([
                    'status' => 'ok',
                    'driver' => $driver,
                    'latency_ms' => round($latencyMs, 3),
                    'connection_name' => $connection,
                    'attempts' => $attempt,
                ], 200);
            } catch (Throwable $e) {
                $latencyMs = (hrtime(true) - $start) / 1e6;
                $lastError = $e->getMessage();
                if ($attempt < self::MAX_ATTEMPTS) {
                    usleep(self::RETRY_DELAY_US);
                }
            }
        }

        return response()->json([
            'status' => 'error',
            'driver' => $driver,
            'latency_ms' => round($latencyMs, 3),
            'connection_name' => $connection,
            'error' => $lastError,
            'attempts' => self::MAX_ATTEMPTS,
        ], 503);
    }
}
