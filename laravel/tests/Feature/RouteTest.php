<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('feature')]
class RouteTest extends TestCase
{
    public function test_registered_get_routes_do_not_return_server_errors(): void
    {
        $getRoutes = collect(Route::getRoutes())
            ->filter(fn ($route) => in_array('GET', $route->methods(), true))
            ->reject(fn ($route) => str_contains($route->uri(), '{'));

        $this->assertNotEmpty($getRoutes, 'Expected at least one registered GET route to smoke test.');

        foreach ($getRoutes as $route) {
            $uri = '/'.ltrim($route->uri(), '/');
            $uri = $uri === '/' ? '/' : rtrim($uri, '/');

            $response = $this->get($uri);

            $this->assertLessThan(
                500,
                $response->getStatusCode(),
                sprintf('GET %s returned a server error.', $uri),
            );
        }
    }
}
