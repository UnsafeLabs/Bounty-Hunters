<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Hash;

class PasswordHashingTest extends TestCase
{
    public function test_bcrypt_rounds_match_config()
    {
        // Get the bcrypt rounds from config
        $rounds = config('hashing.bcrypt.rounds', 10);
        
        // Create a test password
        $password = 'test_password';
        
        // Hash the password with the configured rounds
        $hashed = Hash::make($password, ['rounds' => $rounds]);
        
        // Check that the hash contains the correct number of rounds
        $this->assertStringContainsString('$' . $rounds . '$', $hashed, 'Hashed password does not contain expected rounds');
        
        // Verify the hash works
        $this->assertTrue(Hash::check('test_password', $hashed), 'Password verification failed');
    }

    public function test_password_hashing_respects_config()
    {
        $this->assertTrue(config('hashing.driver') === 'bcrypt', 'Hashing driver is not bcrypt');
        $this->assertIsInt(config('hashing.bcrypt.rounds'), 'Bcrypt rounds not configured properly');
    }
}