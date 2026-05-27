<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NotificationPreference extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'channel',
        'event_type',
        'enabled',
    ];

    protected $casts = [
        'enabled' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function getDefaultChannels(): array
    {
        return ['mail', 'slack', 'database'];
    }

    public static function getDefaultEventTypes(): array
    {
        return [
            'user.registered',
            'user.updated',
            'notification.received',
        ];
    }

    public static function getDefaultsForUser(int $userId): array
    {
        $preferences = [];
        foreach (self::getDefaultEventTypes() as $eventType) {
            foreach (self::getDefaultChannels() as $channel) {
                $preferences[] = [
                    'user_id' => $userId,
                    'channel' => $channel,
                    'event_type' => $eventType,
                    'enabled' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
        }
        return $preferences;
    }
}