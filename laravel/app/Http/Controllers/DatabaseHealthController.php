<?php

namespace App\Http\Controllers;

use App\Services\DatabaseHealthCheck;
use Illuminate\Http\JsonResponse;

class DatabaseHealthController extends Controller
{
    public function __construct(private DatabaseHealthCheck $healthCheck)
    {
    }

    public function show(): JsonResponse
    {
        $result = $this->healthCheck->checkWithRetry();

        $status = $result['status'] === 'healthy' ? 200 : 503;

        return response()->json($result, $status);
    }
}
