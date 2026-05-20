<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DatabaseSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_database_seeder_is_idempotent(): void
    {
        $this->seed();
        $this->seed();

        $this->assertSame(1, User::where('email', 'test@example.com')->count());
        $this->assertSame(3, Role::count());

        foreach (['admin', 'editor', 'viewer'] as $role) {
            $this->assertDatabaseHas('roles', ['name' => $role]);
        }
    }
}
