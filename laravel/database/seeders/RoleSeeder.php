<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    /**
     * Seed the default application roles.
     */
    public function run(): void
    {
        $roles = [
            'admin' => 'Administrator role with full access.',
            'editor' => 'Editor role with content management access.',
            'viewer' => 'Viewer role with read-only access.',
        ];

        foreach ($roles as $name => $description) {
            Role::firstOrCreate(
                ['name' => $name],
                ['description' => $description]
            );
        }
    }
}
