<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    /**
     * Seed the application's roles.
     */
    public function run(): void
    {
        foreach ($this->roles() as $role) {
            Role::firstOrCreate(
                ['name' => $role['name']],
                ['description' => $role['description']],
            );
        }
    }

    /**
     * @return array<int, array{name: string, description: string}>
     */
    private function roles(): array
    {
        return [
            ['name' => 'admin', 'description' => 'Full administrative access'],
            ['name' => 'editor', 'description' => 'Can create and update content'],
            ['name' => 'viewer', 'description' => 'Read-only application access'],
        ];
    }
}
