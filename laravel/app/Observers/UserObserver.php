<?php

namespace App\Observers;

use App\Models\NotificationPreference;
use App\Models\User;

class UserObserver
{
    public function created(User $user): void
    {
        foreach (NotificationPreference::EVENT_TYPES as $eventType) {
            foreach (NotificationPreference::CHANNELS as $channel) {
                NotificationPreference::firstOrCreate([
                    'user_id' => $user->id,
                    'channel' => $channel,
                    'event_type' => $eventType,
                ], [
                    'enabled' => true,
                ]);
            }
        }
    }
}
