<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BcryptRoundsTest extends TestCase
{
    public function test_password_hash_respects_configured_rounds(): void
    {
        $user = new User();
        $user->password = 'test-password';

        $info = password_get_info($user->password);

        $expectedRounds = config('hashing.bcrypt.rounds', 10);
        $this->assertArrayHasKey('options', $info);
        $this->assertEquals($expectedRounds, $info['options']['cost']);
    }
}
