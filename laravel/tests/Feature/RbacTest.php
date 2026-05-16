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

    public function test_user_can_be_assigned_and_removed_from_role(): void
    {
        $user = User::factory()->create();

        $user->assignRole('admin');

        $this->assertTrue($user->hasRole('admin'));

        $user->removeRole('admin');

        $this->assertFalse($user->fresh()->hasRole('admin'));
    }

    public function test_user_inherits_permissions_from_roles_and_direct_permissions(): void
    {
        $user = User::factory()->create();
        $role = Role::query()->create(['name' => 'editor', 'guard_name' => 'web']);
        $publish = Permission::query()->create(['name' => 'posts.publish', 'guard_name' => 'web']);

        $role->givePermissionTo($publish);
        $user->assignRole($role);
        $user->givePermissionTo('posts.update');

        $this->assertTrue($user->hasPermission('posts.publish'));
        $this->assertTrue($user->hasPermission('posts.update'));
        $this->assertFalse($user->hasPermission('posts.delete'));
        $this->assertEqualsCanonicalizing(
            ['posts.publish', 'posts.update'],
            $user->getAllPermissions()->pluck('name')->all()
        );
    }

    public function test_role_middleware_rejects_users_without_required_role(): void
    {
        Route::get('/rbac-admin-area', fn () => 'ok')->middleware('role:admin');

        $this->actingAs(User::factory()->create())
            ->get('/rbac-admin-area')
            ->assertForbidden();
    }

    public function test_role_middleware_allows_users_with_required_role(): void
    {
        Route::get('/rbac-editor-area', fn () => 'ok')->middleware('role:editor');

        $user = User::factory()->create();
        $user->assignRole('editor');

        $this->actingAs($user)
            ->get('/rbac-editor-area')
            ->assertOk()
            ->assertSee('ok');
    }
}
