<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordTest extends TestCase
{
    public function test_password_uses_configured_bcrypt_rounds()
    {
        Config::set('hashing.bcrypt.rounds', 12);
        
        \ = new User();
        \->password = 'secret';
        
        \->assertTrue(Hash::check('secret', \->password));
        \->assertEquals('bcrypt', Hash::info(\->password)['algoName']);
        
        // Since Hash::make generates a hash starting with \\\$ for 12 rounds
        \->assertStringStartsWith('\\\$', \->password);
    }
}
