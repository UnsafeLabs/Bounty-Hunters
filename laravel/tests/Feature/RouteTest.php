<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class RouteTest extends TestCase
{
    /**
     * Test all registered GET routes return non-500 responses.
     *
     * @group feature
     * @group routes
     */
    public function test_all_get_routes_return_non_500_responses(): void
    {
        $routes = Route::getRoutes();
        $getRoutes = $routes->getRoutesByMethod()['GET'] ?? [];

        $this->assertNotEmpty($getRoutes, "No GET routes registered");

        foreach ($getRoutes as $route) {
            $uri = $route->uri();

            // Skip routes with required parameters
            if (preg_match('/\{[^}]+\}/', $uri)) {
                continue;
            }

            $response = $this->get($uri);

            $this->assertNotEquals(
                500,
                $response->getStatusCode(),
                "Route [{$uri}] returned 500 Internal Server Error"
            );
        }
    }

    /**
     * Test the home route returns a successful response.
     *
     * @group feature
     * @group routes
     */
    public function test_home_route_returns_successful_response(): void
    {
        $response = $this->get('/');

        $response->assertStatus(200);
    }
}
