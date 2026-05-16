<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RbacTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    public function test_assign_role(): void
    {
        $this->user->assignRole('admin');
        $this->assertTrue($this->user->hasRole('admin'));
    }

    public function test_remove_role(): void
    {
        $this->user->assignRole('admin');
        $this->user->removeRole('admin');
        $this->assertFalse($this->user->hasRole('admin'));
    }

    public function test_has_role_returns_false_for_unknown(): void
    {
        $this->assertFalse($this->user->hasRole('nonexistent'));
    }

    public function test_has_direct_permission(): void
    {
        $this->user->givePermissionTo('edit-posts');
        $this->assertTrue($this->user->hasPermission('edit-posts'));
    }

    public function test_has_permission_inherited_through_role(): void
    {
        $role = Role::create(['name' => 'editor', 'guard_name' => 'web']);
        $permission = Permission::create(['name' => 'publish-posts', 'guard_name' => 'web']);
        $role->permissions()->attach($permission->id);

        $this->user->assignRole('editor');
        $this->assertTrue($this->user->hasPermission('publish-posts'));
    }

    public function test_has_permission_returns_false_for_unknown(): void
    {
        $this->assertFalse($this->user->hasPermission('nonexistent'));
    }

    public function test_get_all_permissions_merges_direct_and_role(): void
    {
        $this->user->givePermissionTo('direct-perm');

        $role = Role::create(['name' => 'moderator', 'guard_name' => 'web']);
        $perm = Permission::create(['name' => 'role-perm', 'guard_name' => 'web']);
        $role->permissions()->attach($perm->id);
        $this->user->assignRole('moderator');

        $all = $this->user->getAllPermissions();
        $names = $all->pluck('name')->toArray();

        $this->assertContains('direct-perm', $names);
        $this->assertContains('role-perm', $names);
    }

    public function test_check_role_middleware_grants_access(): void
    {
        $this->user->assignRole('admin');
        $this->actingAs($this->user);

        $response = $this->get('/admin');
        $response->assertStatus(200);
    }

    public function test_check_role_middleware_denies_403(): void
    {
        $this->actingAs($this->user);

        $response = $this->get('/admin');
        $response->assertStatus(403);
    }

    public function test_check_role_middleware_denies_unauthenticated(): void
    {
        $response = $this->get('/admin');
        $response->assertStatus(403);
    }
}