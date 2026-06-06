<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PasswordHashingTest extends TestCase
{
    public function test_user_password_mutator_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User();
        $user->password = 'password';

        $this->assertSame(12, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_user_factory_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 13]);

        $user = User::factory()->make();

        $this->assertSame(13, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_existing_hashes_are_not_rehashed(): void
    {
        $existingHash = Hash::make('password', ['rounds' => 10]);

        $user = new User();
        $user->password = $existingHash;

        $this->assertSame($existingHash, $user->password);
        $this->assertTrue(Hash::check('password', $user->password));
    }
}
