<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Tests\TestCase;

class UserPasswordBcryptRoundsTest extends TestCase
{
    use RefreshDatabase;

    public function test_password_hashing_uses_configured_bcrypt_rounds(): void
    {
        $configuredRounds = 12;
        Config::set('hashing.bcrypt.rounds', $configuredRounds);

        $user = new User();
        $user->password = 'secret';

        $info = password_get_info($user->password);

        $this->assertSame($configuredRounds, $info['options']['cost']);
    }

    public function test_password_verification_works_with_different_rounds(): void
    {
        $user = new User();
        $user->password = 'secret';

        $this->assertTrue(password_verify('secret', $user->password));

        // Verify with Hash facade as well
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('secret', $user->password));
    }
}