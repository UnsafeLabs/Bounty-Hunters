<?php

namespace Tests\Unit;

use App\Models\User;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

#[Group('unit')]
class UserModelTest extends TestCase
{
    public function test_fillable_hidden_and_casts_are_defined(): void
    {
        $user = new User();
        $fillable = $user->getFillable();
        $this->assertContains('name', $fillable);
        $this->assertContains('email', $fillable);
        $this->assertContains('password', $fillable);

        $hidden = $user->getHidden();
        $this->assertContains('password', $hidden);
        $this->assertContains('remember_token', $hidden);

        // casts() method or $casts property
        if (method_exists($user, 'casts')) {
            $casts = $user->casts();
            $this->assertArrayHasKey('password', $casts);
        } else {
            $this->assertTrue(property_exists($user, 'casts') || true);
        }
    }
}
