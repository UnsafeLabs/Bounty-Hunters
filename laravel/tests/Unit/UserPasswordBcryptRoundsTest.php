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
        $customRounds = 12;
        Config::set('hashing.bcrypt.rounds', $customRounds);

        $user = new User();
        $user->password = 'secret';

        $this->assertStringStartsWith('$2y$', $user->password);

        // Extract rounds from hash: $2y$<rounds>$...
        $roundsPart = explode('$', $user->password)[2] ?? '';
        $actualRounds = (int) $roundsPart;

        $this->assertSame($customRounds, $actualRounds);
    }
}