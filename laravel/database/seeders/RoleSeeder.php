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
        collect([
            'admin' => 'Full application administration access.',
            'editor' => 'Content creation and editing access.',
            'viewer' => 'Read-only application access.',
        ])->each(function (string $description, string $name): void {
            Role::firstOrCreate(
                ['name' => $name],
                ['description' => $description],
            );
        });
    }
}
