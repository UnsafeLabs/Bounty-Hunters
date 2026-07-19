<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class HealthCheckController extends Controller
{
    public function database()
    {
        $maxRetries = 3;
        $delayMs = 500;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                DB::connection()->getPdo();
                return response()->json([
                    'status' => 'healthy',
                    'database' => 'connected',
                    'attempt' => $attempt,
                ]);
            } catch (\Exception $e) {
                if ($attempt === $maxRetries) {
                    return response()->json([
                        'status' => 'unhealthy',
                        'database' => 'disconnected',
                        'error' => $e->getMessage(),
                        'attempts' => $attempt,
                    ], 503);
                }
                usleep($delayMs * 1000 * $attempt);
            }
        }
    }
}
