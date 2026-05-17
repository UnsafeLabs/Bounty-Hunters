<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\QueryException;
use PDOException;
use Throwable;

class HealthController extends Controller
{
    private const int MAX_RETRIES = 3;
    private const int RETRY_DELAY_MS = 500;

    public function database(): JsonResponse
    {
        $connectionName = Config::get('database.default', 'mysql');
        $driver = Config::get("database.connections.{$connectionName}.driver", 'unknown');

        if (!Config::has("database.connections.{$connectionName}")) {
            $error = "Database connection '{$connectionName}' is not configured.";
            Log::error('Health check configuration error', [
                'connection' => $connectionName,
                'error'      => $error,
            ]);

            return response()->json([
                'status'          => 'error',
                'driver'          => $driver,
                'connection_name' => $connectionName,
                'message'         => $error,
            ], 503);
        }

        $lastException = null;

        for ($attempt = 1; $attempt <= self::MAX_RETRIES; $attempt++) {
            try {
                $start = microtime(true);
                DB::connection($connectionName)->select('SELECT 1');
                $latencyMs = (microtime(true) - $start) * 1000;

                Log::info('Database health check succeeded', [
                    'connection' => $connectionName,
                    'driver'     => $driver,
                    'latency_ms' => round($latencyMs, 2),
                    'attempt'    => $attempt,
                ]);

                return response()->json([
                    'status'          => 'ok',
                    'driver'          => $driver,
                    'latency_ms'      => round($latencyMs, 2),
                    'connection_name' => $connectionName,
                ]);
            } catch (QueryException | PDOException $e) {
                $lastException = $e;
                Log::warning("Database health check attempt {$attempt} failed", [
                    'connection' => $connectionName,
                    'driver'     => $driver,
                    'error'      => $e->getMessage(),
                    'code'       => $e->getCode(),
                ]);

                if ($attempt < self::MAX_RETRIES) {
                    usleep(self::RETRY_DELAY_MS * 1000);
                }
            } catch (Throwable $e) {
                Log::error('Unexpected error during database health check', [
                    'connection' => $connectionName,
                    'driver'     => $driver,
                    'error'      => $e->getMessage(),
                    'trace'      => $e->getTraceAsString(),
                ]);

                return response()->json([
                    'status'          => 'error',
                    'driver'          => $driver,
                    'connection_name' => $connectionName,
                    'message'         => 'Internal server error during health check.',
                ], 503);
            }
        }

        $errorMessage = $lastException
            ? $lastException->getMessage()
            : 'Unknown database connection error';

        Log::error('Database health check failed after ' . self::MAX_RETRIES . ' attempts', [
            'connection' => $connectionName,
            'driver'     => $driver,
            'error'      => $errorMessage,
        ]);

        return response()->json([
            'status'          => 'error',
            'driver'          => $driver,
            'connection_name' => $connectionName,
            'message'         => $errorMessage,
        ], 503);
    }
}
