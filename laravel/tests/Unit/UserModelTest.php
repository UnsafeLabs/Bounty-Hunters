<?php

namespace Tests\Unit;

use App\Models\User;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('unit')]
class UserModelTest extends TestCase
{
    public function test_user_model_fillable_attributes_are_configured(): void
    {
        $user = new User;

        $this->assertSame(['name', 'email', 'password'], $user->getFillable());
    }

    public function test_user_model_hidden_attributes_are_configured(): void
    {
        $user = new User;

        $this->assertSame(['password', 'remember_token'], $user->getHidden());
    }

    public function test_user_model_casts_are_configured(): void
    {
        $user = new User;

        $this->assertSame('datetime', $user->getCasts()['email_verified_at'] ?? null);
        $this->assertSame('hashed', $user->getCasts()['password'] ?? null);
    }
}
