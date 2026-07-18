<?php

namespace Tests\Feature;

use Tests\TestCase;

class RouteTest extends TestCase
{
    public function test_home_route_returns_200(): void
    {
        $response = $this->get('/');
        $response->assertStatus(200);
    }

    public function test_registration_form_route(): void
    {
        $response = $this->get('/register');
        $response->assertStatus(200);
    }

    public function test_login_form_route(): void
    {
        $response = $this->get('/login');
        $response->assertStatus(200);
    }
}
