<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_mutator_uses_configured_bcrypt_rounds(): void
    {
        Config::set('hashing.bcrypt.rounds', 4);

        $user = new User(['password' => 'secret-password']);

        $this->assertSame(4, $this->bcryptRounds($user->password));
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_password_mutator_preserves_existing_hashes(): void
    {
        $legacyHash = Hash::make('secret-password', ['rounds' => 4]);
        Config::set('hashing.bcrypt.rounds', 12);

        $user = new User(['password' => $legacyHash]);

        $this->assertSame($legacyHash, $user->password);
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_uses_configured_bcrypt_rounds(): void
    {
        Config::set('hashing.bcrypt.rounds', 4);

        $user = User::factory()->make();

        $this->assertSame(4, $this->bcryptRounds($user->password));
        $this->assertTrue(Hash::check('password', $user->password));
    }

    private function bcryptRounds(string $hash): int
    {
        preg_match('/^\$2[ayb]\$(\d{2})\$/', $hash, $matches);

        $this->assertNotEmpty($matches, 'Expected a bcrypt hash with an embedded cost.');

        return (int) $matches[1];
    }
}
