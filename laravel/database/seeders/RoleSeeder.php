<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = ['admin', 'editor', 'viewer'];

        foreach ($roles as $role) {
            Role::firstOrCreate(
                ['name' => $role],
                ['description' => "Default {$role} role"]
            );
        }
    }
}
