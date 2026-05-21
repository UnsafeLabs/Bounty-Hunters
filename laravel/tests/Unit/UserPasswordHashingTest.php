<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashingTest extends TestCase
{
    public function test_password_mutator_uses_configured_bcrypt_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 5]);

        $user = new User([
            'password' => 'secret-password',
        ]);

        $this->assertTrue(Hash::check('secret-password', $user->password));
        $this->assertSame(5, Hash::info($user->password)['options']['cost']);
    }

    public function test_password_mutator_preserves_existing_hashes(): void
    {
        $existingHash = Hash::make('secret-password', ['rounds' => 4]);

        config(['hashing.bcrypt.rounds' => 6]);

        $user = new User([
            'password' => $existingHash,
        ]);

        $this->assertSame($existingHash, $user->password);
        $this->assertTrue(Hash::check('secret-password', $user->password));
    }

    public function test_user_factory_hashes_password_with_configured_rounds(): void
    {
        config(['hashing.bcrypt.rounds' => 6]);

        $user = User::factory()->make();

        $this->assertTrue(Hash::check('password', $user->password));
        $this->assertSame(6, Hash::info($user->password)['options']['cost']);
    }

    public function test_user_factory_cache_is_separated_by_round_count(): void
    {
        config(['hashing.bcrypt.rounds' => 5]);
        $lowerCostUser = User::factory()->make();

        config(['hashing.bcrypt.rounds' => 6]);
        $higherCostUser = User::factory()->make();

        $this->assertSame(5, Hash::info($lowerCostUser->password)['options']['cost']);
        $this->assertSame(6, Hash::info($higherCostUser->password)['options']['cost']);
    }
}
