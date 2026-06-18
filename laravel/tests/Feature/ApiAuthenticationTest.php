<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class ApiAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_validates_input_creates_user_and_returns_token(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response
            ->assertCreated()
            ->assertJsonStructure([
                'message',
                'user' => ['id', 'name', 'email'],
                'token',
            ])
            ->assertJsonPath('user.email', 'ada@example.com');

        $user = User::where('email', 'ada@example.com')->firstOrFail();

        $this->assertTrue(Hash::check('password123', $user->password));
        $this->assertDatabaseCount('personal_access_tokens', 1);
        $this->assertNotEmpty($response->json('token'));
    }

    public function test_registration_rejects_duplicate_email_and_short_password(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->postJson('/api/register', [
            'name' => 'Ada Lovelace',
            'email' => 'taken@example.com',
            'password' => 'short',
            'password_confirmation' => 'short',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);
    }

    public function test_login_returns_token_for_valid_credentials(): void
    {
        User::factory()->create([
            'email' => 'ada@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password123',
        ])
            ->assertOk()
            ->assertJsonStructure([
                'message',
                'user' => ['id', 'name', 'email'],
                'token',
            ])
            ->assertJsonPath('user.email', 'ada@example.com');

        $this->assertDatabaseCount('personal_access_tokens', 1);
    }

    public function test_login_returns_unauthorized_for_invalid_credentials(): void
    {
        User::factory()->create([
            'email' => 'ada@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'wrong-password',
        ])
            ->assertUnauthorized()
            ->assertJson([
                'message' => 'Invalid credentials.',
            ]);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_logout_revokes_the_current_access_token(): void
    {
        $user = User::factory()->create();
        $plainTextToken = $user->createToken('test-token')->plainTextToken;

        $this->postJson('/api/logout', [], [
            'Authorization' => 'Bearer '.$plainTextToken,
        ])
            ->assertOk()
            ->assertJson([
                'message' => 'Logged out successfully.',
            ]);

        $this->assertSame(0, PersonalAccessToken::query()->count());
    }

    public function test_logout_requires_authentication(): void
    {
        $this->postJson('/api/logout')
            ->assertUnauthorized();
    }
}
