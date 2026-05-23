<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_model_hashes_password_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 13]);

        $user = new User();
        $user->password = 'secret-password';

        $this->assertSame(13, $this->bcryptRounds($user->password));
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_hashes_password_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 11]);

        $user = User::factory()->make();

        $this->assertSame(11, $this->bcryptRounds($user->password));
        $this->assertTrue(Hash::check('password', $user->password));
    }

    public function test_existing_bcrypt_hashes_with_old_rounds_still_verify(): void
    {
        $legacyHash = Hash::make('legacy-password', ['rounds' => 10]);

        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User();
        $user->password = $legacyHash;

        $this->assertSame($legacyHash, $user->password);
        $this->assertTrue(Hash::check('legacy-password', $user->password));
    }

    private function bcryptRounds(string $hash): int
    {
        $parts = explode('$', $hash);

        return (int) $parts[2];
    }
}
