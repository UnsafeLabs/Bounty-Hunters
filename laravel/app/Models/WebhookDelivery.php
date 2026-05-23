<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WebhookDelivery extends Model
{
    protected $fillable = [
        'webhook_id', 'event', 'payload', 'response_code',
        'attempts', 'next_retry_at', 'delivered_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'next_retry_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    public function webhook()
    {
        return $this->belongsTo(Webhook::class);
    }
}