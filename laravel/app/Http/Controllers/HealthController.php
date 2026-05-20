<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    public function database(): JsonResponse
    {
        $start = microtime(true);
        try {
            DB::connection()->getPdo();
            $latency = (microtime(true) - $start) * 1000;
            return response()->json([
                'status' => 'ok',
                'driver' => config('database.default'),
                'latency_ms' => round($latency, 2),
                'connection_name' => DB::connection()->getName(),
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 503);
        }
    }
}
