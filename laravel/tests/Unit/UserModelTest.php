<?php

namespace Tests\Unit;

use Tests\TestCase;
use App\Models\User;

class UserModelTest extends TestCase
{
    /**
     * Test User model has correct fillable attributes.
     *
     * @group unit
     * @group model
     */
    public function test_user_has_correct_fillable_attributes(): void
    {
        $user = new User();
        $fillable = $user->getFillable();

        $this->assertContains('name', $fillable, 'name should be fillable');
        $this->assertContains('email', $fillable, 'email should be fillable');
        $this->assertContains('password', $fillable, 'password should be fillable');
    }

    /**
     * Test User model has correct hidden attributes.
     *
     * @group unit
     * @group model
     */
    public function test_user_has_correct_hidden_attributes(): void
    {
        $user = new User();
        $hidden = $user->getHidden();

        $this->assertContains('password', $hidden, 'password should be hidden');
        $this->assertContains('remember_token', $hidden, 'remember_token should be hidden');
    }

    /**
     * Test User model has correct casts.
     *
     * @group unit
     * @group model
     */
    public function test_user_has_correct_casts(): void
    {
        $user = new User();
        $casts = $user->getCasts();

        $this->assertArrayHasKey('email_verified_at', $casts, 'email_verified_at should be cast');
        $this->assertEquals('datetime', $casts['email_verified_at'], 'email_verified_at should cast to datetime');
        $this->assertArrayHasKey('password', $casts, 'password should be cast');
        $this->assertEquals('hashed', $casts['password'], 'password should be hashed');
    }
}
