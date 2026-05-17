<?php
namespace Tests\Feature;
use Tests\TestCase;
use PHPUnit\Framework\Attributes\Group;
use Illuminate\Support\Facades\Route;

#[Group("feature")]
class RouteTest extends TestCase
{
    #[Group("routes")]
    public function test_all_get_routes_return_valid_status(): void
    {
        $routes = Route::getRoutes();
        foreach ($routes as $route) {
            if (in_array('GET', $route->methods()) && !str_contains($route->uri(), '{')) {
                $response = $this->get($route->uri());
                $status = $response->status();
                $this->assertNotEquals(500, $status, "Route {$route->uri()} returned 500");
                $this->assertTrue($status >= 200 && $status < 500, "Route {$route->uri()} status: {$status}");
            }
        }
    }
}