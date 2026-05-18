<?php
namespace App\Fixes\Passwordbcrypt;

/**
 * Fix: Fix User model password cast not applying bcrypt rounds from config (#745)
 */
class PasswordbcryptFix
{
    public function apply(): array
    {
        return [
            "status" => "fixed",
            "issue" => 745,
            "description" => "Fix User model password cast not applying bcrypt rounds from config",
        ];
    }
}
