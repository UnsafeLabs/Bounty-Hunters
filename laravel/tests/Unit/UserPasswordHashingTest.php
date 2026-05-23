<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_mutator_respects_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User();
        $user->password = 'secret-password';

        $this->assertTrue(Hash::check('secret-password', $user->password));
        $this->assertSame(6, password_get_info($user->password)['options']['cost']);
    }

    public function test_factory_password_respects_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 5]);

        $password = User::factory()->make()->password;

        $this->assertTrue(Hash::check('password', $password));
        $this->assertSame(5, password_get_info($password)['options']['cost']);
    }

    public function test_existing_bcrypt_hashes_are_not_rehashed(): void
    {
        $existingHash = Hash::make('legacy-password', ['rounds' => 4]);

        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User();
        $user->password = $existingHash;

        $this->assertSame($existingHash, $user->password);
        $this->assertTrue(Hash::check('legacy-password', $user->password));
    }
}
