<?php

namespace Tests\Routes;

use Tests\TestCase;

class WebRoutesTest extends TestCase
{
    public function test_home_page_returns_successful_response(): void
    {
        $response = $this->get('/');

        $response->assertStatus(200);
    }

    public function test_home_page_contains_app_name(): void
    {
        $response = $this->get('/');

        $response->assertSee(config('app.name'));
    }

    public function test_api_routes_return_json(): void
    {
        $response = $this->getJson('/api/user');

        $response->assertStatus(401);
    }
}
