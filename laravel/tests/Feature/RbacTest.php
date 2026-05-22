<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Role;
use App\Models\Permission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RbacTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Create a role
        Role::create(['name' => 'admin', 'guard_name' => 'web']);
        Role::create(['name' => 'moderator', 'guard_name' => 'web']);

        // Create permissions
        Permission::create(['name' => 'manage-users', 'guard_name' => 'web']);
        Permission::create(['name' => 'view-dashboard', 'guard_name' => 'web']);

        // Assign permissions to admin role
        $adminRole = Role::where('name', 'admin')->first();
        $adminRole->givePermissionTo(Permission::where('name', 'manage-users')->first());
        $adminRole->givePermissionTo(Permission::where('name', 'view-dashboard')->first());
    }

    public function test_user_can_be_assigned_a_role(): void
    {
        $user = User::factory()->create();

        $user->assignRole('admin');

        $this->assertTrue($user->hasRole('admin'));
    }

    public function test_user_can_have_multiple_roles(): void
    {
        $user = User::factory()->create();

        $user->assignRole('admin');
        $user->assignRole('moderator');

        $this->assertTrue($user->hasRole('admin'));
        $this->assertTrue($user->hasRole('moderator'));
    }

    public function test_user_can_remove_a_role(): void
    {
        $user = User::factory()->create();

        $user->assignRole('admin');
        $this->assertTrue($user->hasRole('admin'));

        $user->removeRole('admin');
        $this->assertFalse($user->hasRole('admin'));
    }

    public function test_user_has_role_check_with_array(): void
    {
        $user = User::factory()->create();
        $user->assignRole('admin');

        $this->assertTrue($user->hasRole(['admin', 'moderator']));
        $this->assertFalse($user->hasRole(['editor', 'viewer']));
    }

    public function test_user_has_permission_via_role(): void
    {
        $user = User::factory()->create();
        $user->assignRole('admin');

        $this->assertTrue($user->hasPermission('manage-users'));
        $this->assertTrue($user->hasPermission('view-dashboard'));
    }

    public function test_user_does_not_have_permission_without_role(): void
    {
        $user = User::factory()->create();
        // User has no roles

        $this->assertFalse($user->hasPermission('manage-users'));
    }

    public function test_get_all_permissions(): void
    {
        $user = User::factory()->create();
        $user->assignRole('admin');

        $permissions = $user->getAllPermissions();

        $this->assertCount(2, $permissions);
        $this->assertTrue($permissions->pluck('name')->contains('manage-users'));
        $this->assertTrue($permissions->pluck('name')->contains('view-dashboard'));
    }

    public function test_check_role_middleware_allows_access_with_correct_role(): void
    {
        $user = User::factory()->create();
        $user->assignRole('admin');

        $response = $this->actingAs($user)->get('/admin/dashboard');

        $response->assertStatus(200);
    }

    public function test_check_role_middleware_denies_access_without_role(): void
    {
        $user = User::factory()->create();
        // User has no admin role

        $response = $this->actingAs($user)->get('/admin/dashboard');

        $response->assertStatus(403);
    }

    public function test_check_role_middleware_returns_401_when_unauthenticated(): void
    {
        $response = $this->get('/admin/dashboard');

        $response->assertStatus(401);
    }
}