<?php

namespace Tests\Feature;

use Tests\TestCase;

class RouteTest extends TestCase
{
    public function test_all_registered_routes_return_success_or_safe_status(): void
    {
        $routes = collect(app('router')->getRoutes())->filter(function ($route) {
            return in_array('GET', $route->methods());
        });

        foreach ($routes as $route) {
            $response = $this->get($route->uri());
            $status = $response->status();
            $this->assertNotEquals(500, $status, "GET {$route->uri()} returned 500");
        }
    }
}
