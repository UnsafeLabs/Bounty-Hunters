<?php

namespace Tests\Unit;

use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PasswordHashingTest extends TestCase
{
    public function test_user_password_mutator_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User();
        $user->password = 'secret-password';

        $hash = $user->getAttributes()['password'];

        $this->assertTrue(Hash::check('secret-password', $hash));
        $this->assertSame(6, $this->bcryptCost($hash));
    }

    public function test_user_factory_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 7]);

        $attributes = (new UserFactory())->definition();
        $hash = $attributes['password'];

        $this->assertTrue(Hash::check('password', $hash));
        $this->assertSame(7, $this->bcryptCost($hash));
    }

    public function test_existing_default_rounds_hashes_still_verify(): void
    {
        $legacyHash = password_hash('legacy-password', PASSWORD_BCRYPT, ['cost' => 10]);

        $this->assertTrue(Hash::check('legacy-password', $legacyHash));
        $this->assertSame(10, $this->bcryptCost($legacyHash));
    }

    private function bcryptCost(string $hash): int
    {
        $info = password_get_info($hash);

        return (int) ($info['options']['cost'] ?? 0);
    }
}
