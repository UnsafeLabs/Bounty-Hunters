<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Webhook extends Model
{
    /** @use HasFactory<\Database\Factories\WebhookFactory> */
    use HasFactory;

    protected $fillable = [
        'url',
        'secret',
        'events',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'events' => 'array',
            'active' => 'boolean',
        ];
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class);
    }
}
