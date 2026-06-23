<?php

namespace App\Observers;

use App\Models\User;

class UserObserver
{
    /**
     * Seed a freshly created user with a preference row for every configured
     * event type/channel pair, enabling the default channels. This guarantees
     * every user starts with an explicit, editable set of preferences.
     */
    public function created(User $user): void
    {
        $defaults = (array) config('notifications.defaults', []);

        $rows = [];

        foreach ((array) config('notifications.event_types', []) as $eventType) {
            foreach ((array) config('notifications.channels', []) as $channel) {
                $rows[] = [
                    'event_type' => $eventType,
                    'channel' => $channel,
                    'enabled' => in_array($channel, $defaults, true),
                ];
            }
        }

        if ($rows !== []) {
            $user->notificationPreferences()->createMany($rows);
        }
    }
}
