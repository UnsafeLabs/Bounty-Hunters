<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;

class NotificationRouter
{
    public static function shouldSend(User $user, string $channel, string $eventType): bool
    {
        $pref = NotificationPreference::where("user_id", $user->id)
            ->where("channel", $channel)
            ->where("event_type", $eventType)
            ->first();

        return $pref ? $pref->enabled : true; // default to enabled
    }
}
