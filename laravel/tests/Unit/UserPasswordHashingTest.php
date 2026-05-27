<?php

namespace Tests\Unit;

use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_user_model_hashes_password_with_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 5]);

        $user = new User;
        $user->password = 'secret-password';

        $this->assertSame(5, password_get_info($user->password)['options']['cost']);
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_rehashes_when_configured_bcrypt_rounds_change(): void
    {
        config(['hashing.bcrypt.rounds' => 5]);
        $firstPassword = UserFactory::new()->definition()['password'];

        config(['hashing.bcrypt.rounds' => 6]);
        $secondPassword = UserFactory::new()->definition()['password'];

        $this->assertSame(5, password_get_info($firstPassword)['options']['cost']);
        $this->assertSame(6, password_get_info($secondPassword)['options']['cost']);
    }

    public function test_legacy_bcrypt_passwords_still_verify(): void
    {
        $legacyHash = Hash::make('legacy-password', ['rounds' => 4]);

        config(['hashing.bcrypt.rounds' => 6]);

        $this->assertTrue(Hash::check('legacy-password', $legacyHash));
    }
}
