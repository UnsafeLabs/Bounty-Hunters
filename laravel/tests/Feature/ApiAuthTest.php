<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_register(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertCreated();
        $this->assertDatabaseHas('users', ['email' => 'test@example.com']);
    }

    public function test_login(): void
    {
        $user = User::factory()->create(['password' => bcrypt('password123')]);

        $response = $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $response->assertOk();
        $response->assertJsonStructure(['token', 'user']);
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $user = User::factory()->create(['password' => bcrypt('password123')]);

        $response = $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'wrong-password',
        ]);

        $response->assertUnprocessable();
    }

    public function test_me_requires_auth(): void
    {
        $response = $this->getJson('/api/auth/me');
        $response->assertUnauthorized();
    }

    public function test_me_returns_user(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/auth/me');
        $response->assertOk();
        $response->assertJson(['id' => $user->id]);
    }

    public function test_logout(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test')->plainTextToken;

        $response = $this->withHeader('Authorization', "Bearer $token")
            ->postJson('/api/auth/logout');

        $response->assertOk();
    }
}
