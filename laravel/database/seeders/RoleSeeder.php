<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        foreach (
            [
                ['name' => 'admin', 'description' => 'Administrator'],
                ['name' => 'editor', 'description' => 'Editor'],
                ['name' => 'viewer', 'description' => 'Viewer'],
            ] as $role
        ) {
            Role::query()->firstOrCreate(
                ['name' => $role['name']],
                ['description' => $role['description']]
            );
        }
    }
}
