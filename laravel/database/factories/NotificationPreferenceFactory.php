<?php

namespace Database\Factories;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class NotificationPreferenceFactory extends Factory
{
    protected $model = NotificationPreference::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'channel' => fake()->randomElement(['mail', 'slack', 'database']),
            'event_type' => fake()->randomElement(['order_created', 'order_shipped', 'order_delivered', 'payment_received', 'account_updated']),
            'enabled' => fake()->boolean(),
        ];
    }
}