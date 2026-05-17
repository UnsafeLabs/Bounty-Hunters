<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    /**
     * Perform a database health check with retry logic.
     *
     * @return JsonResponse
     */
    public function database(): JsonResponse
    {
        $connectionName = Config::get('database.default');
        $driver = Config::get("database.connections.{$connectionName}.driver", 'unknown');

        $attempts = 3;
        $delayMs = 500;
        $lastException = null;

        for ($i = 0; $i < $attempts; $i++) {
            try {
                $start = microtime(true);

                // Attempt to run a simple query to verify connectivity
                DB::connection()->getPdo();
                // For SQLite, getPdo may not throw an exception if file missing? Actually it does.
                // Run a raw query to be extra safe across all drivers.
                DB::select('SELECT 1');

                $latencyMs = round((microtime(true) - $start) * 1000, 2);

                return response()->json([
                    'status'          => 'ok',
                    'driver'          => $driver,
                    'latency_ms'      => $latencyMs,
                    'connection_name' => $connectionName,
                ], 200);
            } catch (\Exception $e) {
                $lastException = $e;
                if ($i < $attempts - 1) {
                    usleep($delayMs * 1000); // 500ms
                }
            }
        }

        // All attempts failed
        return response()->json([
            'status'          => 'error',
            'message'         => $lastException ? $lastException->getMessage() : 'Unknown database connection error',
            'driver'          => $driver,
            'connection_name' => $connectionName,
        ], 503);
    }
}
