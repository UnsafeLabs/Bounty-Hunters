<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordHashTest extends TestCase
{
    use RefreshDatabase;

    public function test_password_uses_bcrypt_rounds_from_config(): void
    {
        // Test with default rounds (12)
        Config::set('hashing.bcrypt.rounds', 12);

        $user = User::factory()->create([
            'password' => 'test-password-123',
        ]);

        $this->assertTrue(Hash::check('test-password-123', $user->password));
        
        // Verify the hash uses 12 rounds by checking the hash prefix
        // bcrypt hash format: $2y$<rounds>$<salt><hash>
        $this->assertStringStartsWith('$2y$12$', $user->password);
    }

    public function test_password_respects_custom_bcrypt_rounds_from_config(): void
    {
        // Test with custom rounds (10)
        Config::set('hashing.bcrypt.rounds', 10);

        $user = User::factory()->create([
            'password' => 'test-password-456',
        ]);

        $this->assertTrue(Hash::check('test-password-456', $user->password));
        
        // Verify the hash uses 10 rounds
        $this->assertStringStartsWith('$2y$10$', $user->password);
    }

    public function test_password_respects_higher_bcrypt_rounds_from_config(): void
    {
        // Test with higher rounds (14)
        Config::set('hashing.bcrypt.rounds', 14);

        $user = User::factory()->create([
            'password' => 'test-password-789',
        ]);

        $this->assertTrue(Hash::check('test-password-789', $user->password));
        
        // Verify the hash uses 14 rounds
        $this->assertStringStartsWith('$2y$14$', $user->password);
    }

    public function test_set_password_attribute_respects_config_rounds(): void
    {
        Config::set('hashing.bcrypt.rounds', 11);

        $user = new User();
        $user->name = 'Test User';
        $user->email = 'test@example.com';
        $user->password = 'direct-password-set';

        $this->assertTrue(Hash::check('direct-password-set', $user->password));
        $this->assertStringStartsWith('$2y$11$', $user->password);
    }

    public function test_user_factory_respects_config_rounds(): void
    {
        Config::set('hashing.bcrypt.rounds', 13);

        $user = User::factory()->create();

        $this->assertTrue(Hash::check('password', $user->password));
        $this->assertStringStartsWith('$2y$13$', $user->password);
    }
}
