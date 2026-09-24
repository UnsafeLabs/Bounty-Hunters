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

    protected function role(string $name, array $permissions = []): Role
    {
        $role = Role::create(['name' => $name]);

        foreach ($permissions as $permission) {
            $role->givePermissionTo(Permission::firstOrCreate(['name' => $permission]));
        }

        return $role;
    }

    public function test_user_can_be_assigned_and_removed_from_a_role(): void
    {
        $user = User::factory()->create();
        $role = $this->role('admin');

        $user->assignRole('admin');
        $this->assertTrue($user->hasRole('admin'));
        $this->assertDatabaseHas('model_has_roles', [
            'role_id' => $role->id,
            'model_type' => User::class,
            'model_id' => $user->id,
        ]);

        // Assignment is idempotent.
        $user->assignRole('admin');
        $this->assertSame(1, $user->roles()->count());

        $user->removeRole($role);
        $this->assertFalse($user->hasRole('admin'));
        $this->assertDatabaseCount('model_has_roles', 0);
    }

    public function test_has_role_only_matches_the_requested_role(): void
    {
        $user = User::factory()->create();
        $this->role('editor');
        $user->assignRole('editor');

        $this->assertTrue($user->hasRole('editor'));
        $this->assertFalse($user->hasRole('admin'));
    }

    public function test_permissions_can_be_attached_to_a_role(): void
    {
        $permission = Permission::create(['name' => 'posts.edit']);
        $role = $this->role('editor', ['posts.edit']);

        $this->assertTrue($role->permissions->contains($permission));
        $this->assertDatabaseHas('role_has_permissions', [
            'role_id' => $role->id,
            'permission_id' => $permission->id,
        ]);
    }

    public function test_has_permission_checks_direct_permissions(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'posts.delete']);
        $user->permissions()->attach(Permission::where('name', 'posts.delete')->firstOrFail());

        $this->assertTrue($user->hasPermission('posts.delete'));
        $this->assertFalse($user->hasPermission('posts.edit'));
    }

    public function test_has_permission_is_inherited_through_roles(): void
    {
        $user = User::factory()->create();
        $this->role('editor', ['posts.edit']);
        $user->assignRole('editor');

        $this->assertTrue($user->hasPermission('posts.edit'));
        $this->assertFalse($user->hasPermission('posts.delete'));
    }

    public function test_get_all_permissions_merges_direct_and_role_permissions(): void
    {
        Permission::create(['name' => 'posts.edit']);
        Permission::create(['name' => 'posts.delete']);
        Permission::create(['name' => 'users.ban']);

        $user = User::factory()->create();
        $user->permissions()->attach(Permission::where('name', 'users.ban')->firstOrFail());

        $this->role('editor', ['posts.edit']);
        $this->role('moderator', ['posts.edit', 'posts.delete']);
        $user->assignRole('editor');
        $user->assignRole('moderator');

        $names = $user->getAllPermissions()->pluck('name')->all();

        sort($names);
        $this->assertSame(['posts.delete', 'posts.edit', 'users.ban'], $names);
        $this->assertCount(3, $names, 'Duplicate permission across roles must be merged once.');
    }

    public function test_check_role_middleware_rejects_user_without_role(): void
    {
        Route::middleware(['web', 'role:admin'])->get('/rbac-protected', fn () => 'ok');

        $user = User::factory()->create();

        $this->actingAs($user)->get('/rbac-protected')->assertForbidden();
    }

    public function test_check_role_middleware_allows_user_with_role(): void
    {
        Route::middleware(['web', 'role:admin,editor'])->get('/rbac-protected', fn () => 'ok');

        $user = User::factory()->create();
        $this->role('editor');
        $user->assignRole('editor');

        $this->actingAs($user)->get('/rbac-protected')->assertOk()->assertSee('ok');
    }
}
