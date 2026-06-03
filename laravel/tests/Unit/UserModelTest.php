<?php

namespace Tests\Unit;

use App\Models\User;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

/**
 * @group unit
 */
#[Group('unit')]
class UserModelTest extends TestCase
{
    /**
     * Verify that User model configurations (fillable, hidden, casts) are correctly defined.
     */
    public function test_user_model_configuration(): void
    {
        $user = new User();

        // Verify fillable attributes
        $this->assertEquals(['name', 'email', 'password'], $user->getFillable());

        // Verify hidden attributes
        $this->assertEquals(['password', 'remember_token'], $user->getHidden());

        // Verify casts configuration
        $casts = $user->getCasts();
        
        $this->assertArrayHasKey('email_verified_at', $casts);
        $this->assertArrayHasKey('password', $casts);
        $this->assertArrayHasKey('id', $casts);

        $this->assertEquals('datetime', $casts['email_verified_at']);
        $this->assertEquals('hashed', $casts['password']);
    }
}
