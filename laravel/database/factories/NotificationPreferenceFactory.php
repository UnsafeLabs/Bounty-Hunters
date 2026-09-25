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
            'channel' => fake()->randomElement(NotificationPreference::CHANNELS),
            'event_type' => fake()->randomElement(NotificationPreference::DEFAULT_EVENT_TYPES),
            'enabled' => fake()->boolean(),
        ];
    }
}
