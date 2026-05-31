<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    /**
     * Seed the default roles.
     */
    public function run(): void
    {
        foreach ($this->defaultRoles() as $role) {
            Role::firstOrCreate([
                'name' => $role['name'],
            ], [
                'description' => $role['description'],
            ]);
        }
    }

    /**
     * @return array<int, array{name: string, description: string}>
     */
    private function defaultRoles(): array
    {
        return [
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
                'description' => 'Can view application content.',
            ],
        ];
    }
}
