<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    /**
     * Check database connectivity with retry logic.
     *
     * Attempts connection 3 times with 500ms delay before reporting failure.
     * Returns JSON with status, driver, latency_ms, and connection_name.
     */
    public function database(Request $request): JsonResponse
    {
        $maxAttempts = 3;
        $retryDelay = 500; // milliseconds
        $lastError = null;

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                $start = microtime(true);
                DB::connection()->getPdo();
                $latency = round((microtime(true) - $start) * 1000, 2);

                return response()->json([
                    'status' => 'healthy',
                    'driver' => DB::connection()->getDriverName(),
                    'latency_ms' => $latency,
                    'connection_name' => DB::connection()->getName(),
                ], 200);
            } catch (\Exception $e) {
                $lastError = $e->getMessage();
                if ($attempt < $maxAttempts) {
                    usleep($retryDelay * 1000);
                }
            }
        }

        return response()->json([
            'status' => 'unhealthy',
            'error' => $lastError,
            'attempts' => $maxAttempts,
        ], 503);
    }
}
