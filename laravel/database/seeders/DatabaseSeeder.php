<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        User::factory()->firstOrCreate(
            ['email' => 'test@example.com'],
            ['name' => 'Test User']
        );

        $this->call([
            RoleSeeder::class,
        ]);
    }
}
