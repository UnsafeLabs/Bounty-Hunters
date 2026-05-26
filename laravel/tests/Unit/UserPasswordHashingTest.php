<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_hashes_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User;
        $user->password = 'secret-password';

        $this->assertTrue(Hash::check('secret-password', $user->password));
        $this->assertSame(12, password_get_info($user->password)['options']['cost']);
    }

    public function test_user_password_preserves_existing_hashes(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);
        $legacyHash = password_hash('secret-password', PASSWORD_BCRYPT, ['cost' => 10]);

        $user = new User;
        $user->password = $legacyHash;

        $this->assertSame($legacyHash, $user->password);
        $this->assertTrue(Hash::check('secret-password', $user->password));
        $this->assertSame(10, password_get_info($user->password)['options']['cost']);
    }

    public function test_user_factory_hashes_password_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 13]);

        $user = User::factory()->make();

        $this->assertTrue(Hash::check('password', $user->password));
        $this->assertSame(13, password_get_info($user->password)['options']['cost']);
    }
}
