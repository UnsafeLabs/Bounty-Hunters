<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class RouteTest extends TestCase
{
    public function test_all_routes_return_non_500(): void
    {
        $routes = collect(Route::getRoutes())->filter(function ($route) {
            return in_array('GET', $route->methods());
        });

        foreach ($routes as $route) {
            $response = $this->get($route->uri());
            $this->assertNotEquals(500, $response->getStatusCode());
        }
    }
}
