<?php
namespace Tests\Unit;
use Tests\TestCase;
use PHPUnit\Framework\Attributes\Group;
use App\Models\User;

#[Group("unit")]
class UserModelTest extends TestCase
{
    #[Group("attributes")]
    public function test_fillable_attributes(): void
    {
        $fillable = (new User())->getFillable();
        $this->assertContains('name', $fillable);
        $this->assertContains('email', $fillable);
        $this->assertContains('password', $fillable);
    }

    #[Group("attributes")]
    public function test_hidden_attributes(): void
    {
        $user = new User(['name' => 'Test', 'email' => 'test@test.com', 'password' => 'secret']);
        $hidden = $user->getHidden();
        $this->assertContains('password', $hidden);
        $this->assertContains('remember_token', $hidden);
    }

    #[Group("attributes")]
    public function test_casts_are_defined(): void
    {
        $casts = (new User())->getCasts();
        $this->assertArrayHasKey('email_verified_at', $casts);
        $this->assertEquals('datetime', $casts['email_verified_at']);
    }
}