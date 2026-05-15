<?php

namespace App\Http\Controllers;

use App\Services\CacheHealthCheck;
use Illuminate\Http\JsonResponse;

class CacheHealthController extends Controller
{
    public function __construct(
        private CacheHealthCheck $healthCheck,
    ) {}

    public function show(): JsonResponse
    {
        if (!config('cache.health_check_enabled', true)) {
            return response()->json(['message' => 'Cache health check disabled'], 404);
        }

        $result = $this->healthCheck->check();

        if ($result['available']) {
            return response()->json($result, 200);
        }

        return response()->json($result, 503);
    }
}
