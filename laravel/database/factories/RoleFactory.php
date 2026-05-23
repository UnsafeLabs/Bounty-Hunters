<?php

namespace Database\Factories;

use App\Models\Role;
use Illuminate\Database\Eloquent\Factories\Factory;

class RoleFactory extends Factory
{
    protected \ = Role::class;

    public function definition(): array
    {
        return [
            'name' => \->faker->unique()->word(),
            'description' => \->faker->sentence(),
        ];
    }
}
