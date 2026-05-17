<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordCastTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function it_hashes_password_with_configured_bcrypt_rounds()
    {
        $expectedRounds = config('hashing.bcrypt.rounds', 10);

        $user = User::factory()->create([
            'password' => 'test-password',
        ]);

        $info = Hash::info($user->password);

        $this->assertEquals('bcrypt', $info['algoName']);
        $this->assertEquals($expectedRounds, $info['cost']);

        // Ensure password verification still works
        $this->assertTrue(Hash::check('test-password', $user->password));
    }

    /** @test */
    public function it_still_verifies_old_passwords_hashed_with_default_rounds()
    {
        // Simulate a password hashed with default rounds (10)
        $oldPassword = Hash::make('old-password', ['rounds' => 10]);

        $this->assertTrue(Hash::check('old-password', $oldPassword));

        // Ensure the new mutator still works alongside old hashes
        $user = User::factory()->create([
            'password' => $oldPassword, // Should re-hash? No, mutator only called on set, so this will re-hash using config rounds
        ]);

        // The password attribute should now be re-hashed with configured rounds
        $info = Hash::info($user->password);
        $this->assertEquals(config('hashing.bcrypt.rounds', 10), $info['cost']);
    }
}
