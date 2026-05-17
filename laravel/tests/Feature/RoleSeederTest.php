<?php

namespace Tests\Feature;

use App\Models\Role;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class RoleSeederTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Test that the RoleSeeder creates the expected roles.
     */
    public function test_seeder_creates_default_roles(): void
    {
        $this->seed(RoleSeeder::class);

        $this->assertDatabaseHas('roles', ['name' => 'admin']);
        $this->assertDatabaseHas('roles', ['name' => 'editor']);
        $this->assertDatabaseHas('roles', ['name' => 'viewer']);
        $this->assertEquals(3, DB::table('roles')->count());
    }

    /**
     * Test that the RoleSeeder is idempotent.
     */
    public function test_seeder_is_idempotent(): void
    {
        // Run seeder twice
        $this->seed(RoleSeeder::class);
        $this->seed(RoleSeeder::class);

        $this->assertEquals(3, DB::table('roles')->count());
    }
}
