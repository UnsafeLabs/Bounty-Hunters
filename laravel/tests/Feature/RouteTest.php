<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RouteTest extends TestCase
{
    public function test_home_route_returns_success(): void
    {
        $response = $this->get('/');
        $this->assertNotEquals(500, $response->getStatusCode());
    }

    public function test_registered_get_routes_do_not_return_500(): void
    {
        $routes = [
            '/',
            '/login',
            '/register',
        ];

        foreach ($routes as $route) {
            $response = $this->get($route);
            $this->assertNotEquals(500, $response->getStatusCode(), "Route ${route} returned 500");
        }
    }
}
