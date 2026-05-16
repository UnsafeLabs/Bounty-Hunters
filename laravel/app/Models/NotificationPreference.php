<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NotificationPreference extends Model
{
    use HasFactory;

    public const CHANNELS = ['mail', 'slack', 'database'];

    public const DEFAULT_EVENT_TYPES = [
        'account.updated',
        'security.alert',
        'billing.invoice',
    ];

    protected $fillable = [
        'user_id',
        'channel',
        'event_type',
        'enabled',
    ];

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

    public static function seedDefaultsFor(User $user): void
    {
        foreach (self::DEFAULT_EVENT_TYPES as $eventType) {
            foreach (self::CHANNELS as $channel) {
                self::firstOrCreate(
                    [
                        'user_id' => $user->id,
                        'channel' => $channel,
                        'event_type' => $eventType,
                    ],
                    ['enabled' => true],
                );
            }
        }
    }
}
