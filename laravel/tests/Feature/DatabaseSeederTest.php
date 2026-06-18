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

    public function test_database_seeder_can_run_multiple_times_without_duplicate_users_or_roles(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(1, User::where('email', 'test@example.com')->count());
        $this->assertSame(
            ['admin', 'editor', 'viewer'],
            Role::orderBy('name')->pluck('name')->all(),
        );
        $this->assertSame(3, Role::count());
    }

    public function test_role_seeder_is_idempotent(): void
    {
        $this->seed(RoleSeeder::class);
        $this->seed(RoleSeeder::class);

        $this->assertSame(3, Role::count());
        $this->assertSame(
            ['admin', 'editor', 'viewer'],
            Role::orderBy('name')->pluck('name')->all(),
        );
    }

    public function test_role_factory_generates_valid_roles(): void
    {
        $role = Role::factory()->create();

        $this->assertNotNull($role->id);
        $this->assertNotEmpty($role->name);
        $this->assertNotEmpty($role->description);
        $this->assertDatabaseHas('roles', [
            'id' => $role->id,
            'name' => $role->name,
        ]);
    }
}
