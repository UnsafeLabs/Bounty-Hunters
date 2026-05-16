<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class RoleBasedAccessControlTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_be_assigned_and_removed_from_role(): void
    {
        $user = User::factory()->create();
        $role = Role::query()->create(['name' => 'editor']);

        $user->assignRole($role);

        $this->assertTrue($user->hasRole('editor'));
        $this->assertTrue($user->hasRole($role));

        $user->removeRole('editor');

        $this->assertFalse($user->hasRole('editor'));
    }

    public function test_role_can_have_permissions_attached(): void
    {
        $role = Role::query()->create(['name' => 'publisher']);
        $permission = Permission::query()->create(['name' => 'publish posts']);

        $role->givePermissionTo($permission);

        $this->assertTrue($role->permissions()->whereKey($permission->getKey())->exists());

        $role->revokePermissionTo('publish posts');

        $this->assertFalse($role->permissions()->whereKey($permission->getKey())->exists());
    }

    public function test_user_has_direct_and_role_inherited_permissions(): void
    {
        $user = User::factory()->create();
        $role = Role::query()->create(['name' => 'manager']);
        $approveInvoices = Permission::query()->create(['name' => 'approve invoices']);
        $viewReports = Permission::query()->create(['name' => 'view reports']);

        $role->givePermissionTo($approveInvoices);
        $user->assignRole($role);
        $user->permissions()->attach($viewReports);

        $this->assertTrue($user->hasPermission('approve invoices'));
        $this->assertTrue($user->hasPermission($viewReports));
        $this->assertFalse($user->hasPermission('delete users'));

        $this->assertEqualsCanonicalizing(
            ['approve invoices', 'view reports'],
            $user->getAllPermissions()->pluck('name')->all(),
        );
    }

    public function test_role_middleware_rejects_users_without_required_role(): void
    {
        Route::middleware('role:admin')->get('/rbac-protected', fn () => 'allowed');

        $user = User::factory()->create();

        $this->actingAs($user)->get('/rbac-protected')->assertForbidden();

        $user->assignRole(Role::query()->create(['name' => 'admin']));

        $this->actingAs($user)->get('/rbac-protected')->assertOk()->assertSee('allowed');
    }
}
