<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_password_mutator_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 12]);

        $user = new User([
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'secret-password',
        ]);

        $this->assertTrue(Hash::check('secret-password', $user->password));
        $this->assertSame(12, password_get_info($user->password)['options']['cost']);
    }

    public function test_user_password_mutator_does_not_rehash_existing_hashes(): void
    {
        $hash = Hash::make('secret-password', ['rounds' => 10]);

        $user = new User([
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => $hash,
        ]);

        $this->assertSame($hash, $user->password);
    }

    public function test_user_factory_password_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 11]);

        $attributes = User::factory()->definition();

        $this->assertTrue(Hash::check('password', $attributes['password']));
        $this->assertSame(11, password_get_info($attributes['password'])['options']['cost']);
    }
}
