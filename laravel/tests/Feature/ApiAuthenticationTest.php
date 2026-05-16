<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class ApiAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_and_receive_token(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'password',
            'password_confirmation' => 'password',
        ]);

        $response
            ->assertCreated()
            ->assertJsonStructure([
                'user' => ['id', 'name', 'email'],
                'token',
            ]);

        $this->assertDatabaseHas('users', ['email' => 'test@example.com']);
        $this->assertDatabaseCount('personal_access_tokens', 1);
    }

    public function test_user_can_login_and_receive_token(): void
    {
        User::factory()->create([
            'email' => 'test@example.com',
            'password' => 'password',
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'test@example.com',
            'password' => 'password',
        ]);

        $response
            ->assertOk()
            ->assertJsonStructure([
                'user' => ['id', 'name', 'email'],
                'token',
            ]);

        $this->assertDatabaseCount('personal_access_tokens', 1);
    }

    public function test_login_rejects_invalid_credentials(): void
    {
        User::factory()->create([
            'email' => 'test@example.com',
            'password' => 'password',
        ]);

        $this->postJson('/api/login', [
            'email' => 'test@example.com',
            'password' => 'wrong-password',
        ])
            ->assertUnauthorized()
            ->assertJsonValidationErrors('email');
    }

    public function test_authenticated_user_can_logout_current_token(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('api-token')->plainTextToken;

        $this->postJson('/api/logout', [], [
            'Authorization' => 'Bearer '.$token,
        ])->assertOk();

        $this->assertSame(0, PersonalAccessToken::count());
    }

    public function test_logout_requires_authentication(): void
    {
        $this->postJson('/api/logout')->assertUnauthorized();
    }
}
