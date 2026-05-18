<?php
namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Fix: DatabaseSeeder creating duplicate test user on re-run (#746)
 * Solution: useFirstOrCreate instead of create
 */
class FixedDatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Use updateOrCreate to prevent duplicates on re-run
        DB::table("users")->updateOrInsert(
            ["email" => "test@example.com"],
            [
                "name" => "Test User",
                "password" => Hash::make("password"),
                "email_verified_at" => now(),
                "created_at" => now(),
                "updated_at" => now(),
            ]
        );
    }
}
