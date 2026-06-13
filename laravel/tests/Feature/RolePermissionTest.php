<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class RolePermissionTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_can_be_assigned_and_removed_from_roles(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'admin']);

        $user->assignRole($role);

        $this->assertTrue($user->hasRole('admin'));

        $user->removeRole('admin');

        $this->assertFalse($user->hasRole('admin'));
    }

    public function test_roles_can_have_permissions_and_users_inherit_them(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'editor']);
        $permission = Permission::create(['name' => 'publish-posts']);

        $role->givePermissionTo($permission);
        $user->assignRole($role);

        $this->assertTrue($role->hasPermission('publish-posts'));
        $this->assertTrue($user->hasPermission('publish-posts'));
        $this->assertTrue($user->getAllPermissions()->contains('name', 'publish-posts'));
    }

    public function test_users_can_hold_direct_permissions(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'view-reports']);

        $user->givePermissionTo('view-reports');

        $this->assertTrue($user->hasPermission('view-reports'));
        $this->assertTrue($user->getAllPermissions()->contains('name', 'view-reports'));
    }

    public function test_role_middleware_allows_matching_role_only(): void
    {
        Route::get('/role-gated', fn () => 'ok')->middleware('role:admin');

        $admin = User::factory()->create();
        $viewer = User::factory()->create();
        $admin->assignRole(Role::create(['name' => 'admin']));

        $this->actingAs($admin)->get('/role-gated')->assertOk();
        $this->actingAs($viewer)->get('/role-gated')->assertForbidden();
    }
}
