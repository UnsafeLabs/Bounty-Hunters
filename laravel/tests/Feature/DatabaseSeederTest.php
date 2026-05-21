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

        $this->assertSame(
            1,
            User::query()->where('email', 'test@example.com')->count(),
        );
        $this->assertSame(3, Role::query()->count());

        foreach (['admin', 'editor', 'viewer'] as $roleName) {
            $this->assertDatabaseHas('roles', ['name' => $roleName]);
        }
    }

    public function test_role_seeder_is_idempotent(): void
    {
        $this->seed(RoleSeeder::class);
        $this->seed(RoleSeeder::class);

        $this->assertSame(3, Role::query()->count());
    }

    public function test_role_factory_generates_valid_roles(): void
    {
        $role = Role::factory()->make();

        $this->assertNotEmpty($role->name);
        $this->assertNotEmpty($role->description);
    }
}
