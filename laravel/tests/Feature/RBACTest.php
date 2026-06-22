<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Role;
use App\Models\Permission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RBACTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_role()
    {
        $role = Role::create(["name" => "admin"]);
        $this->assertEquals("admin", $role->name);
    }

    public function test_assign_role_to_user()
    {
        $role = Role::create(["name" => "editor"]);
        $user = User::factory()->create(["active" => 1]);
        $user->assignRole("editor");

        $this->assertTrue($user->hasRole("editor"));
    }

    public function test_remove_role_from_user()
    {
        $role = Role::create(["name" => "moderator"]);
        $user = User::factory()->create(["active" => 1]);
        $user->assignRole("moderator");
        $user->removeRole("moderator");

        $this->assertFalse($user->hasRole("moderator"));
    }

    public function test_role_permission_checking()
    {
        $role = Role::create(["name" => "admin"]);
        $perm = Permission::create(["name" => "manage-users"]);
        $role->permissions()->attach($perm);

        $user = User::factory()->create(["active" => 1]);
        $user->assignRole("admin");

        $this->assertTrue($user->hasPermission("manage-users"));
        $this->assertFalse($user->hasPermission("nonexistent"));
    }
}
