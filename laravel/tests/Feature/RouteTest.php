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
            if (! in_array('GET', $route->methods(), true) || str_contains($route->uri(), '{')) {
                continue;
            }

            $path = '/'.ltrim($route->uri(), '/');
            $response = $this->get($path);

            $this->assertLessThan(
                500,
                $response->getStatusCode(),
                sprintf('GET %s returned a server error.', $path),
            );
        }
    }
}
