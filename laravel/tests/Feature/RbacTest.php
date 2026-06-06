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

    public function test_permissions_include_direct_and_role_permissions(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'editor', 'guard_name' => 'web']);
        $publish = Permission::create(['name' => 'publish posts', 'guard_name' => 'web']);
        $archive = Permission::create(['name' => 'archive posts', 'guard_name' => 'web']);

        $role->permissions()->attach($publish);
        $user->assignRole($role);
        $user->givePermissionTo($archive);

        $this->assertTrue($user->hasPermission('publish posts'));
        $this->assertTrue($user->hasPermission('archive posts'));
        $this->assertFalse($user->hasPermission('delete posts'));
        $this->assertSame(
            ['archive posts', 'publish posts'],
            $user->getAllPermissions()->pluck('name')->sort()->values()->all()
        );
    }

    public function test_role_middleware_allows_required_role_and_rejects_missing_role(): void
    {
        Route::middleware(['web', 'auth', 'role:admin'])->get('/rbac-test/admin', fn () => 'ok');

        $admin = User::factory()->create();
        $admin->assignRole('admin');
        $guest = User::factory()->create();

        $this->actingAs($admin)
            ->get('/rbac-test/admin')
            ->assertOk()
            ->assertSee('ok');

        $this->actingAs($guest)
            ->get('/rbac-test/admin')
            ->assertForbidden();
    }
}
