<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithFaker;
use Tests\TestCase;
use Illuminate\Support\Facades\Hash;

class UserPasswordHashingTest extends TestCase
{
    use RefreshDatabase, WithFaker;

    public function test_password_uses_configured_bcrypt_rounds()
    {
        $rounds = config('hashing.bcrypt.rounds');
        $password = 'secret';
        $hashedPassword = Hash::make($password, ['rounds' => $rounds]);
        
        $this->assertEquals($rounds, 10);
        $this->assertTrue(Hash::check($password, $hashedPassword));
    }

    public function test_user_password_hashing_respects_config()
    {
        // This assumes there's a User model instance to test against
        // We'll create a user and check if the password was hashed with the right cost
        $user = User::factory()->make([
            'password' => 'password'
        ]);
        
        $hash = $user->password;
        $expectedRounds = config('hashing.bcrypt.rounds');
        $info = password_get_info($hash);
        
        $this->assertArrayHasKey('cost', $info);
        $this->assertEquals($expectedRounds, $info['cost']);
    }
}