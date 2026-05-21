<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('feature')]
class RouteTest extends TestCase
{
    public function test_all_registered_get_routes_return_non_server_errors(): void
    {
        $routes = collect(Route::getRoutes())
            ->filter(fn ($route) => in_array('GET', $route->methods(), true))
            ->reject(fn ($route) => count($route->parameterNames()) > 0)
            ->values();

        $this->assertNotEmpty($routes, 'Expected at least one parameterless GET route.');

        foreach ($routes as $route) {
            $uri = '/'.ltrim($route->uri(), '/');
            $response = $this->get($uri);

            $this->assertLessThan(
                500,
                $response->getStatusCode(),
                sprintf('GET %s returned a server error.', $uri),
            );
        }
    }
}
