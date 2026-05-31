<?php

namespace App\Http\Controllers;

use App\Services\CacheHealthCheck;
use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    public function cache(CacheHealthCheck $healthCheck): JsonResponse
    {
        $result = $healthCheck->check();

        return response()->json($result, $result['available'] ? 200 : 503);
    }
}
