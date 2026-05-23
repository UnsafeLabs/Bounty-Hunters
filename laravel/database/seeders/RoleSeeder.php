<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        \ = [
            ['name' => 'admin', 'description' => 'Administrator'],
            ['name' => 'editor', 'description' => 'Editor'],
            ['name' => 'viewer', 'description' => 'Viewer'],
        ];

        foreach (\ as \) {
            DB::table('roles')->updateOrInsert(
                ['name' => \['name']],
                ['description' => \['description'], 'created_at' => now(), 'updated_at' => now()]
            );
        }
    }
}
