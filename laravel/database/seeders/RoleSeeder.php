<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = ['admin', 'editor', 'viewer'];
        foreach ($roles as $role) {
            DB::table('roles')->updateOrInsert(
                ['name' => $role],
                ['uuid' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now()]
            );
        }
    }
}
