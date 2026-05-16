<?php

namespace Tests\Unit;

use Tests\TestCase;
use App\Models\User;

class UserModelTest extends TestCase
{
    public function test_fillable_attributes(): void
    {
        $user = new User();
        $fillable = $user->getFillable();
        $this->assertContains('name', $fillable);
        $this->assertContains('email', $fillable);
        $this->assertContains('password', $fillable);
    }

    public function test_hidden_attributes(): void
    {
        $user = new User([
            'name' => 'Test',
            'email' => 'test@test.com',
            'password' => 'secret',
        ]);
        $hidden = $user->getHidden();
        $this->assertContains('password', $hidden);
        $this->assertContains('remember_token', $hidden);
    }

    public function test_casts_are_defined(): void
    {
        $user = new User();
        $casts = $user->getCasts();
        $this->assertArrayHasKey('email_verified_at', $casts);
        $this->assertEquals('datetime', $casts['email_verified_at']);
    }

    public function test_user_factory(): void
    {
        $user = User::factory()->make([
            'name' => 'Test User',
            'email' => 'test@test.com',
        ]);
        $this->assertEquals('Test User', $user->name);
        $this->assertEquals('test@test.com', $user->email);
    }
}