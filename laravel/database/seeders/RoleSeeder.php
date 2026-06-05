<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    /**
     * @var array<int, array{name: string, description: string}>
     */
    private const ROLES = [
        [
            'name' => 'admin',
            'description' => 'Full access to manage the application.',
        ],
        [
            'name' => 'editor',
            'description' => 'Can create and update application content.',
        ],
        [
            'name' => 'viewer',
            'description' => 'Read-only access to application content.',
        ],
    ];

    /**
     * Seed the default application roles.
     */
    public function run(): void
    {
        foreach (self::ROLES as $role) {
            Role::firstOrCreate([
                'name' => $role['name'],
            ], [
                'description' => $role['description'],
            ]);
        }
    }
}
