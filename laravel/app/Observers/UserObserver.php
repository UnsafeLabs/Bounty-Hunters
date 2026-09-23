<?php

namespace App\Observers;

use App\Models\NotificationPreference;
use App\Models\User;

class UserObserver
{
    public function created(User $user): void
    {
        $defaultPreferences = [];

        foreach (NotificationPreference::DEFAULT_EVENT_TYPES as $eventType) {
            foreach (NotificationPreference::CHANNELS as $channel) {
                $defaultPreferences[] = [
                    'channel' => $channel,
                    'event_type' => $eventType,
                    'enabled' => $channel !== 'slack',
                ];
            }
        }

        $user->notificationPreferences()->createMany($defaultPreferences);
    }
}
