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
        foreach ($this->defaultRoles() as $role) {
            Role::query()->updateOrCreate(
                ['name' => $role['name']],
                ['description' => $role['description']],
            );
        }
    }

    /**
     * @return array<int, array{name: string, description: string}>
     */
    private function defaultRoles(): array
    {
        return [
            ['name' => 'admin', 'description' => 'Full application administration access'],
            ['name' => 'editor', 'description' => 'Can create and update application content'],
            ['name' => 'viewer', 'description' => 'Read-only application access'],
        ];
    }
}
