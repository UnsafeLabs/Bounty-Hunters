<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     *
     * @var array<int, string>
     */
    protected static array $passwords = [];

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::password(),
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * Get the cached factory password for the configured bcrypt rounds.
     */
    protected static function password(): string
    {
        $rounds = (int) config('hashing.bcrypt.rounds');

        return static::$passwords[$rounds] ??= Hash::make('password', [
            'rounds' => $rounds,
        ]);
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }
}
