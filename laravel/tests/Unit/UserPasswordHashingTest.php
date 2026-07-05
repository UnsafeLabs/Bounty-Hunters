<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_hashing_respects_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User([
            'password' => 'secret-password',
        ]);

        $this->assertSame(6, $this->bcryptCost($user->password));
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_hashing_respects_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 7]);

        $user = User::factory()->make();

        $this->assertSame(7, $this->bcryptCost($user->password));
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_existing_bcrypt_password_hashes_are_preserved(): void
    {
        $legacyHash = Hash::make('legacy-password', ['rounds' => 10]);

        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User([
            'password' => $legacyHash,
        ]);

        $this->assertSame($legacyHash, $user->password);
        $this->assertTrue(Hash::check('legacy-password', $user->password));
    }

    private function bcryptCost(string $hash): int
    {
        $info = password_get_info($hash);

        return (int) ($info['options']['cost'] ?? 0);
    }
}
