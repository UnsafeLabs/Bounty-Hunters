<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Route;

class RouteTest extends TestCase
{
    public function test_all_get_routes_return_valid_status(): void
    {
        $routes = Route::getRoutes();
        foreach ($routes as $route) {
            $methods = $route->methods();
            if (in_array('GET', $methods)) {
                $uri = $route->uri();
                if (str_contains($uri, '{')) {
                    continue;
                }
                $response = $this->get($uri);
                $status = $response->status();
                $this->assertNotEquals(500, $status, "Route {$uri} returned 500");
                $this->assertTrue($status >= 200 && $status < 500);
            }
        }
    }
}