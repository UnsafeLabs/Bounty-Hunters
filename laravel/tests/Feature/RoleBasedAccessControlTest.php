<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use InvalidArgumentException;
use Tests\TestCase;

class RoleBasedAccessControlTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_role_can_be_assigned_to_a_user_by_name_or_model(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'editor']);

        $user->assignRole('editor');

        $this->assertTrue($user->hasRole('editor'));
        $this->assertTrue($user->hasRole($role));
        $this->assertTrue($user->hasRole($role->id));
        $this->assertDatabaseHas('model_has_roles', [
            'role_id' => $role->id,
            'model_id' => $user->id,
            'model_type' => $user->getMorphClass(),
        ]);
    }

    public function test_assigning_the_same_role_twice_does_not_duplicate_it(): void
    {
        $user = User::factory()->create();
        Role::create(['name' => 'editor']);

        $user->assignRole('editor')->assignRole('editor');

        $this->assertCount(1, $user->roles);
    }

    public function test_a_role_can_be_removed_from_a_user(): void
    {
        $user = User::factory()->create();
        Role::create(['name' => 'editor']);
        $user->assignRole('editor');

        $user->removeRole('editor');

        $this->assertFalse($user->hasRole('editor'));
    }

    public function test_roles_can_be_synced_to_an_exact_set(): void
    {
        $user = User::factory()->create();
        Role::create(['name' => 'editor']);
        Role::create(['name' => 'author']);
        $user->assignRole('editor');

        $user->syncRoles('author');

        $this->assertFalse($user->hasRole('editor'));
        $this->assertTrue($user->hasRole('author'));
        $this->assertCount(1, $user->roles);
    }

    public function test_has_any_and_has_all_roles(): void
    {
        $user = User::factory()->create();
        Role::create(['name' => 'editor']);
        Role::create(['name' => 'author']);
        $user->assignRole('editor', 'author');

        $this->assertTrue($user->hasAnyRole('admin', 'editor'));
        $this->assertFalse($user->hasAnyRole('admin'));
        $this->assertTrue($user->hasAllRoles('editor', 'author'));
        $this->assertFalse($user->hasAllRoles('editor', 'admin'));
        $this->assertFalse($user->hasAllRoles());
    }

    public function test_a_user_inherits_permissions_through_their_roles(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'editor']);
        $permission = Permission::create(['name' => 'edit-posts']);
        $role->givePermissionTo('edit-posts');
        $user->assignRole($role);

        $this->assertTrue($user->hasPermission('edit-posts'));
        $this->assertTrue($user->hasPermission($permission));
        $this->assertFalse($user->hasPermission('delete-posts'));
        $this->assertTrue($user->getAllPermissions()->contains(fn (Permission $granted) => $granted->name === 'edit-posts'));
    }

    public function test_a_user_can_be_granted_a_permission_directly(): void
    {
        $user = User::factory()->create();
        $permission = Permission::create(['name' => 'edit-posts']);

        $user->givePermissionTo('edit-posts');

        $this->assertTrue($user->hasPermission('edit-posts'));
        $this->assertTrue($user->hasPermission($permission));
        $this->assertDatabaseHas('model_has_permissions', [
            'permission_id' => $permission->id,
            'model_id' => $user->id,
            'model_type' => $user->getMorphClass(),
        ]);
    }

    public function test_a_direct_permission_can_be_revoked(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'edit-posts']);
        $user->givePermissionTo('edit-posts');

        $user->revokePermissionTo('edit-posts');

        $this->assertFalse($user->hasPermission('edit-posts'));
    }

    public function test_get_all_permissions_merges_direct_and_inherited(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'edit-posts']);
        Permission::create(['name' => 'publish-posts']);
        Role::create(['name' => 'editor'])->givePermissionTo('edit-posts');
        $user->assignRole('editor');
        $user->givePermissionTo('publish-posts');

        $names = $user->getAllPermissions()->pluck('name')->sort()->values()->all();

        $this->assertSame(['edit-posts', 'publish-posts'], $names);
        $this->assertTrue($user->hasPermission('edit-posts'));
        $this->assertTrue($user->hasPermission('publish-posts'));
    }

    public function test_direct_and_inherited_permissions_are_deduplicated(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'edit-posts']);
        Role::create(['name' => 'editor'])->givePermissionTo('edit-posts');
        $user->assignRole('editor');
        $user->givePermissionTo('edit-posts');

        $this->assertCount(1, $user->getAllPermissions());
    }

    public function test_permissions_are_unique_across_overlapping_roles(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'edit-posts']);
        $editor = Role::create(['name' => 'editor'])->givePermissionTo('edit-posts');
        $author = Role::create(['name' => 'author'])->givePermissionTo('edit-posts');
        $user->assignRole($editor, $author);

        $this->assertCount(1, $user->getAllPermissions());
    }

    public function test_permissions_resolve_through_the_authorization_gate(): void
    {
        $user = User::factory()->create();
        Permission::create(['name' => 'edit-posts']);
        Role::create(['name' => 'editor'])->givePermissionTo('edit-posts');
        $user->assignRole('editor');

        $this->assertTrue($user->can('edit-posts'));
        $this->assertFalse($user->can('delete-posts'));
    }

    public function test_a_permission_can_be_revoked_from_a_role(): void
    {
        Permission::create(['name' => 'edit-posts']);
        $role = Role::create(['name' => 'editor'])->givePermissionTo('edit-posts');

        $role->revokePermissionTo('edit-posts');

        $this->assertFalse($role->hasPermissionTo('edit-posts'));
    }

    public function test_roles_and_permissions_default_to_the_web_guard(): void
    {
        $role = Role::create(['name' => 'editor']);
        $permission = Permission::create(['name' => 'edit-posts']);

        $this->assertSame('web', $role->guard_name);
        $this->assertSame('web', $permission->guard_name);
    }

    public function test_check_role_middleware_rejects_users_without_the_role(): void
    {
        Role::create(['name' => 'admin']);
        Route::middleware('role:admin')->get('/rbac-test/admin', fn () => 'ok');

        $user = User::factory()->create();

        $this->actingAs($user)->get('/rbac-test/admin')->assertForbidden();
    }

    public function test_check_role_middleware_allows_users_with_the_role(): void
    {
        Role::create(['name' => 'admin']);
        Route::middleware('role:admin')->get('/rbac-test/admin-allowed', fn () => 'ok');

        $user = User::factory()->create();
        $user->assignRole('admin');

        $this->actingAs($user)->get('/rbac-test/admin-allowed')->assertOk()->assertSee('ok');
    }

    public function test_check_role_middleware_rejects_guests(): void
    {
        Route::middleware('role:admin')->get('/rbac-test/guest', fn () => 'ok');

        $this->get('/rbac-test/guest')->assertForbidden();
    }

    public function test_assigning_an_unknown_role_throws(): void
    {
        $user = User::factory()->create();

        $this->expectException(InvalidArgumentException::class);

        $user->assignRole('does-not-exist');
    }

    public function test_granting_an_unknown_permission_throws(): void
    {
        $role = Role::create(['name' => 'editor']);

        $this->expectException(InvalidArgumentException::class);

        $role->givePermissionTo('does-not-exist');
    }
}
