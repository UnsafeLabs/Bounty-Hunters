<?php

namespace Tests\Feature;

use Tests\TestCase;

class DatabaseHealthTest extends TestCase
{
    public function test_database_health_endpoint_returns_connection_details(): void
    {
        $response = $this->getJson('/health/database');

        $response->assertOk()
            ->assertJsonStructure([
                'status',
                'driver',
                'latency_ms',
                'connection_name',
            ])
            ->assertJson(['status' => 'ok']);
    }
}
