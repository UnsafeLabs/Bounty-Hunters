<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_model_hashes_passwords_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User([
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'secret-password',
        ]);

        $hash = $user->getAttribute('password');

        $this->assertTrue(Hash::check('secret-password', $hash));
        $this->assertSame(12, password_get_info($hash)['options']['cost']);
    }

    public function test_user_factory_hashes_passwords_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 11]);

        $user = User::factory()->make();
        $hash = $user->getAttribute('password');

        $this->assertTrue(Hash::check('password', $hash));
        $this->assertSame(11, password_get_info($hash)['options']['cost']);
    }

    public function test_existing_password_hashes_still_verify(): void
    {
        $existingHash = Hash::make('secret-password', ['rounds' => 10]);

        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User([
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => $existingHash,
        ]);

        $this->assertSame($existingHash, $user->getAttribute('password'));
        $this->assertTrue(Hash::check('secret-password', $user->getAttribute('password')));
    }
}
