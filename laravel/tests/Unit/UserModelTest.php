<?php

namespace Tests\Unit;

use Tests\TestCase;
use App\Models\User;

class UserModelTest extends TestCase
{
    /** @group unit */
    public function test_fillable_attributes_are_defined()
    {
        $user = new User();
        $fillable = $user->getFillable();
        $this->assertContains('name', $fillable);
        $this->assertContains('email', $fillable);
        $this->assertContains('password', $fillable);
    }

    /** @group unit */
    public function test_hidden_attributes_are_defined()
    {
        $user = new User();
        $hidden = $user->getHidden();
        $this->assertContains('password', $hidden);
        $this->assertContains('remember_token', $hidden);
    }

    /** @group unit */
    public function test_casts_are_defined()
    {
        $user = new User();
        $casts = $user->getCasts();
        $this->assertArrayHasKey('email_verified_at', $casts);
    }
}
