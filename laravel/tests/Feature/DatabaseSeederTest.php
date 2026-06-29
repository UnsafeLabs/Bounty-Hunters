<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DatabaseSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_database_seeder_is_idempotent_and_creates_default_roles(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(1, User::where('email', 'test@example.com')->count());
        $this->assertDatabaseCount('roles', 3);
        $this->assertDatabaseHas('roles', [
            'name' => 'admin',
            'description' => 'Full administrative access.',
        ]);
        $this->assertDatabaseHas('roles', [
            'name' => 'editor',
            'description' => 'Can create and edit content.',
        ]);
        $this->assertDatabaseHas('roles', [
            'name' => 'viewer',
            'description' => 'Can view application content.',
        ]);
    }

    public function test_role_factory_generates_valid_role_instances(): void
    {
        $role = Role::factory()->make();

        $this->assertNotEmpty($role->name);
        $this->assertNotEmpty($role->description);
    }
}
