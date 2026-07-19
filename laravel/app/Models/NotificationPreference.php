<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class NotificationPreference extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'email_enabled',
        'sms_enabled',
        'push_enabled',
        'slack_enabled',
        'channels',
    ];

    protected function casts(): array
    {
        return [
            'email_enabled' => 'boolean',
            'sms_enabled' => 'boolean',
            'push_enabled' => 'boolean',
            'slack_enabled' => 'boolean',
            'channels' => 'array',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function shouldSendVia(string $channel): bool
    {
        return match ($channel) {
            'email' => $this->email_enabled,
            'sms' => $this->sms_enabled,
            'push' => $this->push_enabled,
            'slack' => $this->slack_enabled,
            default => in_array($channel, $this->channels ?? []),
        };
    }

    public function getEnabledChannels(): array
    {
        $channels = [];
        if ($this->email_enabled) $channels[] = 'email';
        if ($this->sms_enabled) $channels[] = 'sms';
        if ($this->push_enabled) $channels[] = 'push';
        if ($this->slack_enabled) $channels[] = 'slack';
        return $channels;
    }
}
