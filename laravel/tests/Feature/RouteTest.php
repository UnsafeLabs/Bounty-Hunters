<?php

namespace Tests\Feature;

use Tests\TestCase;

class RouteTest extends TestCase
{
    /** @group feature */
    public function test_home_route_returns_success()
    {
        $response = $this->get('/');
        $this->assertNotEquals(500, $response->getStatusCode());
    }

    /** @group feature */
    public function test_login_route_returns_success()
    {
        $response = $this->get('/login');
        $this->assertNotEquals(500, $response->getStatusCode());
    }

    /** @group feature */
    public function test_register_route_returns_success()
    {
        $response = $this->get('/register');
        $this->assertNotEquals(500, $response->getStatusCode());
    }
}
