<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_mutator_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User;
        $user->password = 'secret-password';

        $this->assertSame(6, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_generates_passwords_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 7]);

        $user = User::factory()->make();

        $this->assertSame(7, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_existing_default_bcrypt_hashes_still_verify_without_rehashing(): void
    {
        $legacyHash = Hash::make('legacy-password', ['rounds' => 10]);

        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User;
        $user->password = $legacyHash;

        $this->assertSame($legacyHash, $user->password);
        $this->assertSame(10, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('legacy-password', $user->password));
    }
}
