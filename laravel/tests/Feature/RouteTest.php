<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('feature')]
class RouteTest extends TestCase
{
    public function test_registered_get_routes_do_not_return_server_error(): void
    {
        $routes = app('router')->getRoutes();
        foreach ($routes as $route) {
            $methods = $route->methods();
            if (! in_array('GET', $methods, true)) {
                continue;
            }
            $uri = $route->uri();
            // Skip parameterized routes without defaults
            if (str_contains($uri, '{')) {
                continue;
            }
            $response = $this->get('/'.ltrim($uri, '/'));
            $this->assertLessThan(
                500,
                $response->getStatusCode(),
                "Route GET /{$uri} returned {$response->getStatusCode()}"
            );
        }
        $this->assertTrue(true);
    }
}
