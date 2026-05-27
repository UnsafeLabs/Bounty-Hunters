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
        $user->save();

        $hash = $user->password;
        $cost = (int) explode('$', $hash)[3] ?? 0;

        $this->assertEquals($customRounds, $cost);
    }
}