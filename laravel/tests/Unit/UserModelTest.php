<?php

namespace Tests\Unit;

use App\Models\User;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

#[Group('unit')]
class UserModelTest extends TestCase
{
    public function test_user_model_has_expected_fillable_attributes(): void
    {
        $user = new User;

        $this->assertSame(['name', 'email', 'password'], $user->getFillable());
    }

    public function test_user_model_has_expected_hidden_attributes(): void
    {
        $user = new User;

        $this->assertSame(['password', 'remember_token'], $user->getHidden());
    }

    public function test_user_model_has_expected_casts(): void
    {
        $casts = (new User)->getCasts();

        $this->assertSame('datetime', $casts['email_verified_at']);
        $this->assertSame('hashed', $casts['password']);
    }
}
