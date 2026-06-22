<?php

namespace Tests\Feature;

use App\Models\User;
use App\Observers\UserObserver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Illuminate\Support\Facades\Schema;

class GlobalScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_scope_filters_inactive()
    {
        $user = User::factory()->create(["active" => 1]);
        $inactive = User::factory()->create(["active" => 0]);

        $users = User::all();
        $this->assertTrue($users->contains($user));
        $this->assertFalse($users->contains($inactive));
    }

    public function test_without_global_scope_returns_all()
    {
        User::factory()->create(["active" => 1]);
        User::factory()->create(["active" => 0]);

        $users = User::withoutGlobalScope(\App\Scopes\ActiveScope::class)->get();
        $this->assertEquals(2, $users->count());
    }

    public function test_user_observer_generates_uuid()
    {
        $user = User::factory()->create(["active" => 1]);
        $this->assertNotNull($user->uuid);
    }

    public function test_uuid_is_unique()
    {
        $u1 = User::factory()->create(["active" => 1]);
        $u2 = User::factory()->create(["active" => 1]);
        $this->assertNotEquals($u1->uuid, $u2->uuid);
    }
}
