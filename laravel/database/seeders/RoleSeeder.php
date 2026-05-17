<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RoleSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $roles = [
            ['name' => 'admin', 'description' => 'System Administrator'],
            ['name' => 'editor', 'description' => 'Content Editor'],
            ['name' => 'viewer', 'description' => 'Standard Viewer'],
        ];

        foreach ($roles as $role) {
            DB::table('roles')->updateOrInsert(
                ['name' => $role['name']],
                ['description' => $role['description'], 'created_at' => now(), 'updated_at' => now()]
            );
        }
    }
}
