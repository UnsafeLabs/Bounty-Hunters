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
            'admin' => 'Full administrative access.',
            'editor' => 'Can create and update content.',
            'viewer' => 'Can view content without making changes.',
        ];

        foreach ($roles as $name => $description) {
            Role::firstOrCreate(
                ['name' => $name],
                ['description' => $description],
            );
        }
    }
}
