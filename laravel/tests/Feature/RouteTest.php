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
        foreach (Route::getRoutes() as $route) {
            if (! in_array('GET', $route->methods(), true)) {
                continue;
            }

            if (str_contains($route->uri(), '{')) {
                continue;
            }

            $response = $this->get($route->uri());

            $this->assertLessThan(
                500,
                $response->getStatusCode(),
                "GET /{$route->uri()} returned a server error"
            );
        }
    }
}
