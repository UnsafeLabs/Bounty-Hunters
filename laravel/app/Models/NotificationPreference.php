<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'user_id',
    'channel',
    'event_type',
    'enabled',
])]
class NotificationPreference extends Model
{
    public const CHANNELS = [
        'mail',
        'slack',
        'database',
    ];

    public const DEFAULT_EVENT_TYPES = [
        'account.updated',
        'security.alert',
        'weekly.digest',
    ];

    /**
     * Seed default notification preferences for a user.
     */
    public static function seedDefaultsFor(User $user): void
    {
        foreach (self::DEFAULT_EVENT_TYPES as $eventType) {
            foreach (self::CHANNELS as $channel) {
                self::query()->firstOrCreate([
                    'user_id' => $user->id,
                    'channel' => $channel,
                    'event_type' => $eventType,
                ], [
                    'enabled' => true,
                ]);
            }
        }
    }

    /**
     * Get the user that owns the preference.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
        ];
    }
}
