<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class RbacTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_can_be_assigned_and_removed_from_roles(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'admin', 'guard_name' => 'web']);

        $user->assignRole($role);
        $this->assertTrue($user->hasRole('admin'));

        $user->removeRole('admin');
        $this->assertFalse($user->hasRole('admin'));
    }

    public function test_users_have_direct_and_role_permissions(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'editor', 'guard_name' => 'web']);
        $publish = Permission::create(['name' => 'publish', 'guard_name' => 'web']);
        $delete = Permission::create(['name' => 'delete', 'guard_name' => 'web']);

        $role->permissions()->attach($publish);
        $user->assignRole($role);
        $user->permissions()->attach($delete);

        $this->assertTrue($user->hasPermission('publish'));
        $this->assertTrue($user->hasPermission('delete'));
        $this->assertSame(
            ['delete', 'publish'],
            $user->getAllPermissions()->pluck('name')->sort()->values()->all()
        );
    }

    public function test_role_middleware_rejects_missing_role(): void
    {
        Route::middleware('role:admin')->get('/admin-only', fn () => 'ok');

        $user = User::factory()->create();

        $this->actingAs($user)->get('/admin-only')->assertForbidden();

        $user->assignRole('admin');

        $this->actingAs($user)->get('/admin-only')->assertOk();
    }
}
