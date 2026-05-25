<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            ['name' => 'admin', 'description' => 'Administrator with full access'],
            ['name' => 'editor', 'description' => 'Editor with content management access'],
            ['name' => 'viewer', 'description' => 'Viewer with read-only access'],
        ];

        foreach ($roles as $role) {
            DB::table('roles')->updateOrInsert(
                ['name' => $role['name']],
                [
                    'description' => $role['description'],
                    'uuid' => Str::uuid(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            );
        }
    }
}
