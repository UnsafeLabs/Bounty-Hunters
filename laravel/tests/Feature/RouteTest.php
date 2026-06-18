<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('feature')]
class RouteTest extends TestCase
{
    public function test_all_registered_get_routes_return_non_server_error_responses(): void
    {
        $routes = collect(Route::getRoutes())->filter(function ($route): bool {
            return in_array('GET', $route->methods(), true)
                && ! str_contains($route->uri(), '{');
        });

        $this->assertNotEmpty($routes);

        $routes->each(function ($route): void {
            $uri = '/'.ltrim($route->uri(), '/');
            $response = $this->get($uri === '/' ? '/' : $uri);

            $this->assertLessThan(
                500,
                $response->getStatusCode(),
                sprintf('GET %s returned a server error.', $uri),
            );
        });
    }
}
