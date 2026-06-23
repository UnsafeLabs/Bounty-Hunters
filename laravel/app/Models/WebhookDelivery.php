<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WebhookDelivery extends Model
{
    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'webhook_id',
        'event',
        'payload',
        'response_code',
        'attempts',
        'next_retry_at',
        'delivered_at',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'response_code' => 'integer',
            'attempts' => 'integer',
            'next_retry_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    /**
     * The webhook this delivery belongs to.
     *
     * @return BelongsTo<Webhook, $this>
     */
    public function webhook(): BelongsTo
    {
        return $this->belongsTo(Webhook::class);
    }

    /**
     * Whether the payload was delivered successfully.
     */
    public function wasDelivered(): bool
    {
        return $this->delivered_at !== null;
    }
}
