<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserFactoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_password_hash_uses_configured_bcrypt_rounds(): void
    {
        $expectedRounds = config('hashing.bcrypt.rounds');

        $user = User::factory()->create();

        $hashInfo = password_get_info($user->password);

        $this->assertEquals($expectedRounds, $hashInfo['options']['cost'], sprintf(
            'Expected bcrypt cost of %d from config, got %d',
            $expectedRounds,
            $hashInfo['options']['cost'] ?? 0
        ));
    }
}
