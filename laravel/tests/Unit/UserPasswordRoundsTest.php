<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordRoundsTest extends TestCase
{
    public function test_password_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User();
        $user->password = 'secret-password';

        $hash = $user->password;
        $this->assertTrue(Hash::check('secret-password', $hash));

        // bcrypt cost is encoded as $2y$12$...
        $this->assertMatchesRegularExpression('/^\$2[ayb]\$12\$/', $hash);
    }

    public function test_password_uses_custom_rounds_from_config(): void
    {
        config(['hashing.bcrypt.rounds' => 8]);

        $user = new User();
        $user->password = 'another-secret';

        $hash = $user->password;
        $this->assertTrue(Hash::check('another-secret', $hash));
        $this->assertMatchesRegularExpression('/^\$2[ayb]\$08\$/', $hash);
    }

    public function test_hash_check_still_works_for_default_rounds_hashes(): void
    {
        // Simulate legacy hash created with default cost 10
        $legacy = password_hash('legacy-pass', PASSWORD_BCRYPT, ['cost' => 10]);
        $this->assertTrue(Hash::check('legacy-pass', $legacy));
    }
}
