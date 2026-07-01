<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_password_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User;
        $user->password = 'secret';

        $this->assertMatchesRegularExpression('/^\$2[ay]\$(\d+)\$/', $user->password);
        preg_match('/^\$2[ay]\$(\d+)\$/', $user->password, $matches);
        $this->assertSame('12', $matches[1]);
    }

    public function test_factory_password_respects_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 4]);

        $user = User::factory()->make(['password' => 'password']);

        preg_match('/^\$2[ay]\$(\d+)\$/', $user->password, $matches);
        $this->assertSame('4', $matches[1]);
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_hash_check_works_for_passwords_hashed_with_default_rounds(): void
    {
        $legacyHash = Hash::make('legacy-password', ['rounds' => 10]);

        $this->assertTrue(Hash::check('legacy-password', $legacyHash));
    }
}
