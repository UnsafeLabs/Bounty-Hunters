<?php

namespace Database\Factories;

use App\Models\Webhook;
use Illuminate\Database\Eloquent\Factories\Factory;

class WebhookFactory extends Factory
{
    protected $model = Webhook::class;

    public function definition(): array
    {
        return [
            'url' => fake()->url(),
            'secret' => \Illuminate\Support\Str::random(32),
            'events' => ['order.created', 'order.updated'],
            'active' => true,
        ];
    }
}
