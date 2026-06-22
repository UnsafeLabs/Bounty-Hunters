<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    public function test_health_endpoint_returns_healthy()
    {
        $response = $this->get("/health/database");
        $response->assertStatus(200);
        $response->assertJsonStructure([
            "status",
            "driver",
            "latency_ms",
            "connection_name",
        ]);
        $response->assertJson(["status" => "healthy"]);
    }

    public function test_health_endpoint_has_latency()
    {
        $response = $this->get("/health/database");
        $data = $response->json();
        $this->assertIsNumeric($data["latency_ms"]);
        $this->assertGreaterThan(0, $data["latency_ms"]);
    }
}
