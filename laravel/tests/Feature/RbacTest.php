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
        Role::create(['name' => 'admin']);

        $user->assignRole('admin');

        $this->assertTrue($user->hasRole('admin'));
        $this->assertDatabaseHas('model_has_roles', [
            'role_id' => Role::where('name', 'admin')->value('id'),
            'model_type' => User::class,
            'model_id' => $user->id,
        ]);

        $user->removeRole('admin');

        $this->assertFalse($user->hasRole('admin'));
    }

    public function test_permissions_include_direct_and_role_inherited_permissions(): void
    {
        $user = User::factory()->create();
        $role = Role::create(['name' => 'editor']);
        $publish = Permission::create(['name' => 'publish articles']);
        $delete = Permission::create(['name' => 'delete articles']);

        $role->permissions()->attach($publish);
        $user->permissions()->attach($delete);
        $user->assignRole($role);

        $this->assertTrue($user->hasPermission('publish articles'));
        $this->assertTrue($user->hasPermission('delete articles'));
        $this->assertFalse($user->hasPermission('archive articles'));

        $this->assertSame(
            ['delete articles', 'publish articles'],
            $user->getAllPermissions()->pluck('name')->sort()->values()->all(),
        );
    }

    public function test_role_middleware_rejects_users_without_required_role(): void
    {
        Route::middleware(['web', 'auth', 'role:admin'])
            ->get('/admin-only-test', fn () => 'ok')
            ->name('admin-only-test');

        $user = User::factory()->create();

        $this->actingAs($user)
            ->get('/admin-only-test')
            ->assertForbidden();

        Role::create(['name' => 'admin']);
        $user->assignRole('admin');

        $this->actingAs($user->fresh())
            ->get('/admin-only-test')
            ->assertOk()
            ->assertSee('ok');
    }
}
