<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DatabaseSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_database_seeder_can_run_more_than_once(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(1, User::where('email', 'test@example.com')->count());
        $this->assertDatabaseHas('users', [
            'email' => 'test@example.com',
            'name' => 'Test User',
        ]);

        $this->assertSame(3, Role::count());
        $this->assertDefaultRolesExist();
    }

    public function test_role_seeder_can_run_more_than_once(): void
    {
        $this->seed(RoleSeeder::class);
        $this->seed(RoleSeeder::class);

        $this->assertSame(3, Role::count());
        $this->assertDefaultRolesExist();
    }

    public function test_role_factory_creates_valid_roles(): void
    {
        $role = Role::factory()->create();

        $this->assertNotEmpty($role->name);
        $this->assertNotEmpty($role->description);
        $this->assertDatabaseHas('roles', [
            'id' => $role->id,
            'name' => $role->name,
            'description' => $role->description,
        ]);
    }

    private function assertDefaultRolesExist(): void
    {
        foreach (['admin', 'editor', 'viewer'] as $roleName) {
            $this->assertDatabaseHas('roles', [
                'name' => $roleName,
            ]);
        }
    }
}
