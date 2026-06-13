<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NotificationPreference extends Model
{
    public const CHANNELS = ['mail', 'slack', 'database'];

    public const EVENT_TYPES = ['comment.created', 'mention.created', 'weekly.summary'];

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
            'user_id' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
