<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Webhook extends Model
{
    protected $fillable = ['url', 'secret', 'events', 'active'];

    protected function casts(): array
    {
        return [
            'events' => 'array',
            'active' => 'boolean',
        ];
    }

    public function deliveries()
    {
        return $this->hasMany(WebhookDelivery::class);
    }
}