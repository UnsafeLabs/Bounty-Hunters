<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PasswordHashingTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Password hashing respects the configured bcrypt rounds.
     */
    public function test_password_hashing_uses_configured_rounds(): void
    {
        $configuredRounds = (int) config('hashing.bcrypt.rounds', 10);

        $user = User::factory()->create([
            'password' => 'secret123',
        ]);

        $hashedPassword = $user->password;

        // bcrypt hashes start with $2y$ followed by the round count
        $this->assertStringStartsWith('$2y$', $hashedPassword);

        // Extract the round count from the hash
        // Format: $2y$<rounds>$<salt><hash>
        $parts = explode('$', $hashedPassword);
        $actualRounds = (int) ($parts[2] ?? 0);

        $this->assertEquals(
            $configuredRounds,
            $actualRounds,
            "Password should be hashed with {$configuredRounds} rounds, got {$actualRounds}"
        );
    }

    /**
     * Password verification still works with the custom mutator.
     */
    public function test_password_verification_works(): void
    {
        $user = User::factory()->create([
            'password' => 'secret123',
        ]);

        $this->assertTrue(
            Hash::check('secret123', $user->password),
            'Hash::check should return true for the correct password'
        );

        $this->assertFalse(
            Hash::check('wrongpassword', $user->password),
            'Hash::check should return false for an incorrect password'
        );
    }
}
