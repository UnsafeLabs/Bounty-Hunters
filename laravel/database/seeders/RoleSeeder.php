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
            'admin' => 'Full access to manage users, content, and application settings.',
            'editor' => 'Can create, edit, and publish application content.',
            'viewer' => 'Read-only access to application content.',
        ];

        foreach ($roles as $name => $description) {
            Role::query()->firstOrCreate(
                ['name' => $name],
                ['description' => $description],
            );
        }
    }
}
