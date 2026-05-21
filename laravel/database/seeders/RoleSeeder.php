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
            [
                'name' => 'admin',
                'description' => 'Full administrative access.',
            ],
            [
                'name' => 'editor',
                'description' => 'Can create and edit application content.',
            ],
            [
                'name' => 'viewer',
                'description' => 'Read-only application access.',
            ],
        ];

        foreach ($roles as $role) {
            Role::query()->firstOrCreate(
                ['name' => $role['name']],
                ['description' => $role['description']],
            );
        }
    }
}
