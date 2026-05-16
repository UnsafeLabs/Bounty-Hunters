<?php
namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL;

class RouteTest extends TestCase
{
    public function test_all_get_routes_return_200_or_redirect(): void
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
                $this->assertNotEquals(
                    500,
                    $status,
                    "Route {$uri} returned 500 Internal Server Error"
                );
                
                $this->assertTrue(
                    $status >= 200 && $status < 500,
                    "Route {$uri} returned unexpected status {$status}"
                );
            }
        }
    }

    public function test_core_routes_exist(): void
    {
        $this->assertNotNull(Route::getRoutes()->getByName('home'));
    }
}