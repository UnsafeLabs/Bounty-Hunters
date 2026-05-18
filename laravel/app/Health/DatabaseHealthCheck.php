<?php
namespace App\Health;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

/**
 * Fix: Add database health check endpoint with retry logic (#785)
 */
class DatabaseHealthCheck
{
    private int $maxRetries = 3;
    private int $retryDelayMs = 500;

    public function check(): array
    {
        $result = [
            "status" => "healthy",
            "timestamp" => now()->toIso8601String(),
            "checks" => [],
        ];

        // Primary connection check with retry
        $result["checks"]["database"] = $this->checkWithRetry(function () {
            DB::connection()->getPdo();
            return ["latency_ms" => $this->measureLatency()];
        });

        // Cache check
        $result["checks"]["cache"] = $this->checkCache();

        // Migration status
        $result["checks"]["migrations"] = $this->checkMigrations();

        // Overall status
        $unhealthy = collect($result["checks"])->where("status", "!=", "healthy")->count();
        if ($unhealthy > 0) {
            $result["status"] = $unhealthy === count($result["checks"]) ? "unhealthy" : "degraded";
        }

        return $result;
    }

    private function checkWithRetry(callable $check, int $attempt = 0): array
    {
        try {
            return array_merge(["status" => "healthy"], $check());
        } catch (\Throwable $e) {
            if ($attempt < $this->maxRetries - 1) {
                usleep($this->retryDelayMs * 1000 * ($attempt + 1));
                return $this->checkWithRetry($check, $attempt + 1);
            }
            return ["status" => "unhealthy", "error" => $e->getMessage()];
        }
    }

    private function measureLatency(): float
    {
        $start = microtime(true);
        DB::select("SELECT 1");
        return round((microtime(true) - $start) * 1000, 2);
    }

    private function checkCache(): array
    {
        try {
            $key = "health_check_" . time();
            Cache::put($key, true, 10);
            $ok = Cache::get($key) === true;
            Cache::forget($key);
            return ["status" => $ok ? "healthy" : "unhealthy"];
        } catch (\Throwable $e) {
            return ["status" => "unhealthy", "error" => $e->getMessage()];
        }
    }

    private function checkMigrations(): array
    {
        try {
            $pending = count(DB::select("SELECT 1 FROM migrations LIMIT 1"));
            return ["status" => "healthy", "applied" => true];
        } catch (\Throwable $e) {
            return ["status" => "unhealthy", "error" => "Migrations table not accessible"];
        }
    }
}
