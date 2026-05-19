<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RolePermissionTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_be_assigned_roles_and_permissions(): void
    {
        $user = User::factory()->create();
        $role = Role::factory()->create(['name' => 'admin']);
        $permission = Permission::factory()->create(['name' => 'posts.update']);

        $role->permissions()->attach($permission);
        $user->assignRole($role);

        $this->assertTrue($user->hasRole('admin'));
        $this->assertTrue($user->hasPermissionTo('posts.update'));
        $this->assertCount(1, $user->getAllPermissions());
    }

    public function test_user_can_receive_direct_permission(): void
    {
        $user = User::factory()->create();
        $permission = Permission::factory()->create(['name' => 'reports.view']);

        $user->givePermissionTo('reports.view');

        $this->assertTrue($user->hasPermissionTo($permission));
    }

    public function test_role_and_permission_assignments_can_be_removed(): void
    {
        $user = User::factory()->create();
        $role = Role::factory()->create(['name' => 'editor']);
        $permission = Permission::factory()->create(['name' => 'posts.delete']);

        $user->assignRole('editor');
        $user->givePermissionTo('posts.delete');
        $user->removeRole($role);
        $user->revokePermissionTo($permission);

        $this->assertFalse($user->hasRole('editor'));
        $this->assertFalse($user->hasPermissionTo('posts.delete'));
    }
}
