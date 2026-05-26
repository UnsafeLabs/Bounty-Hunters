<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
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
     * @return list<array{name: string, description: string}>
     */
    private function roles(): array
    {
        return [
            ['name' => 'admin', 'description' => 'Full administrative access'],
            ['name' => 'editor', 'description' => 'Content editing access'],
            ['name' => 'viewer', 'description' => 'Read-only access'],
        ];
    }
}
