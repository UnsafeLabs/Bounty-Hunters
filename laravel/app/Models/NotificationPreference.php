<?php

namespace App\Models;

use Database\Factories\NotificationPreferenceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'channel', 'event_type', 'enabled'])]
class NotificationPreference extends Model
{
    use HasFactory;

    public const CHANNELS = ['mail', 'slack', 'database'];

    public const DEFAULT_EVENT_TYPES = [
        'order_created',
        'order_shipped',
        'order_delivered',
        'payment_received',
        'account_updated',
    ];

    protected static function newFactory(): NotificationPreferenceFactory
    {
        return NotificationPreferenceFactory::new();
    }

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
