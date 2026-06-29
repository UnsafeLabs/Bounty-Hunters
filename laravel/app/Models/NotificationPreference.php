<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'channel', 'event_type', 'enabled'])]
class NotificationPreference extends Model
{
    public const CHANNEL_MAIL = 'mail';

    public const CHANNEL_SLACK = 'slack';

    public const CHANNEL_DATABASE = 'database';

    public const CHANNELS = [
        self::CHANNEL_MAIL,
        self::CHANNEL_SLACK,
        self::CHANNEL_DATABASE,
    ];

    /**
     * @return BelongsTo<User, NotificationPreference>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
        ];
    }
}
