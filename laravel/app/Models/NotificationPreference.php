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
        return ['comment', 'mention', 'task_assigned', 'task_completed', 'general'];
    }
}