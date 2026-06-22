<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    public function database(): JsonResponse
    {
        $connection = Config::get("database.default");
        $driver = Config::get("database.connections.".$connection.".driver", $connection);
        $maxAttempts = 3;
        $delayMs = 500;
        $latency = null;
        $lastError = null;

        for ($i = 0; $i < $maxAttempts; $i++) {
            $start = microtime(true);
            try {
                DB::connection()->getPdo();
                DB::select("SELECT 1");
                $latency = round((microtime(true) - $start) * 1000, 2);
                $lastError = null;
                break;
            } catch (\Exception $e) {
                $lastError = $e->getMessage();
                if ($i < $maxAttempts - 1) {
                    usleep($delayMs * 1000);
                }
            }
        }

        if ($lastError !== null) {
            return response()->json([
                "status" => "unhealthy",
                "driver" => $driver,
                "connection_name" => $connection,
                "error" => $lastError,
            ], 503);
        }

        return response()->json([
            "status" => "healthy",
            "driver" => $driver,
            "latency_ms" => $latency,
            "connection_name" => $connection,
        ]);
    }
}
