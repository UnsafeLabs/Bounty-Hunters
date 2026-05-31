<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_hashing_respects_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User;
        $user->password = 'secret-password';

        $this->assertSame(12, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_generates_passwords_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 13]);

        $user = User::factory()->make();

        $this->assertSame(13, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_existing_bcrypt_hashes_are_preserved_for_legacy_verification(): void
    {
        $legacyHash = Hash::make('secret-password', ['rounds' => 10]);

        $user = new User;
        $user->password = $legacyHash;

        $this->assertSame($legacyHash, $user->password);
        $this->assertSame(10, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }
}
