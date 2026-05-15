<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    use RefreshDatabase;

    public function test_password_hashing_respects_configured_bcrypt_rounds(): void
    {
        // phpunit.xml sets BCRYPT_ROUNDS=4
        $user = User::factory()->create([
            'password' => 'secret123',
        ]);

        $hash = $user->getAttributes()['password'];

        // Verify it's a valid bcrypt hash
        $this->assertTrue(Hash::check('secret123', $hash));

        // The cost factor embedded in the hash should match configured rounds (4)
        $info = password_get_info($hash);
        $this->assertEquals(4, $info['options']['cost'] ?? 0);
    }

    public function test_backward_compatibility_with_old_default_rounds(): void
    {
        // Simulate a password hashed with the old default (10 rounds)
        $oldHash = Hash::make('oldpassword', ['rounds' => 10]);

        // Hash::check should still pass regardless of current config
        $this->assertTrue(Hash::check('oldpassword', $oldHash));
    }
}
