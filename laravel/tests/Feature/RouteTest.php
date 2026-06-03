<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

/**
 * @group feature
 */
#[Group('feature')]
class RouteTest extends TestCase
{
    /**
     * Verify that all registered GET routes return a non-500 response status code.
     */
    public function test_all_get_routes_return_non_500(): void
    {
        $routes = Route::getRoutes()->getRoutes();

        foreach ($routes as $route) {
            if (in_array('GET', $route->methods())) {
                $uri = $route->uri();

                // Replace any parameter placeholders (e.g. {path}) with dummy values
                $url = preg_replace('/\{[a-zA-Z0-9_?]+\}/', 'dummy', $uri);
                $url = '/' . ltrim($url, '/');

                $response = $this->get($url);
                $status = $response->getStatusCode();

                $this->assertLessThan(500, $status, "Route GET {$url} returned a 500 error status code ($status).");
            }
        }
    }
}
