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

        $user = new User();
        $user->password = 'secret-password';

        $this->assertSame(6, $this->bcryptCost($user->password));
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 5]);

        $user = User::factory()->make();

        $this->assertSame(5, $this->bcryptCost($user->password));
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_existing_bcrypt_hashes_are_not_rehashed(): void
    {
        $legacyHash = Hash::make('legacy-password', ['rounds' => 4]);

        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User();
        $user->password = $legacyHash;

        $this->assertSame($legacyHash, $user->password);
        $this->assertSame(4, $this->bcryptCost($user->password));
        $this->assertTrue(Hash::check('legacy-password', $user->password));
    }

    private function bcryptCost(string $hash): int
    {
        $info = password_get_info($hash);

        return (int) $info['options']['cost'];
    }
}
