<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ApiAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_and_receive_bearer_token(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonPath('user.email', 'ada@example.com')
            ->assertJsonStructure(['token', 'expires_at']);

        $token = $response->json('token');

        $this->assertDatabaseHas('users', ['email' => 'ada@example.com']);
        $this->assertDatabaseMissing('api_tokens', ['token' => $token]);
        $this->assertDatabaseHas('api_tokens', ['token' => hash('sha256', $token)]);
    }

    public function test_user_can_login_and_access_current_user(): void
    {
        User::factory()->create([
            'email' => 'grace@example.com',
            'password' => Hash::make('secure-password'),
        ]);

        $login = $this->postJson('/api/login', [
            'email' => 'grace@example.com',
            'password' => 'secure-password',
        ]);

        $login->assertOk()->assertJsonPath('token_type', 'Bearer');

        $this
            ->withToken($login->json('token'))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.email', 'grace@example.com');
    }

    public function test_invalid_login_does_not_issue_token(): void
    {
        User::factory()->create([
            'email' => 'alan@example.com',
            'password' => Hash::make('right-password'),
        ]);

        $this
            ->postJson('/api/login', [
                'email' => 'alan@example.com',
                'password' => 'wrong-password',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->assertDatabaseCount('api_tokens', 0);
    }

    public function test_logout_revokes_current_token(): void
    {
        $user = User::factory()->create();
        $plainToken = 'plain-test-token';
        ApiToken::create([
            'user_id' => $user->id,
            'name' => 'api',
            'token' => hash('sha256', $plainToken),
            'expires_at' => now()->addDay(),
        ]);

        $this
            ->withToken($plainToken)
            ->postJson('/api/logout')
            ->assertOk()
            ->assertJsonPath('message', 'Logged out.');

        $this->assertDatabaseCount('api_tokens', 0);

        $this
            ->withToken($plainToken)
            ->getJson('/api/user')
            ->assertUnauthorized();
    }
}
