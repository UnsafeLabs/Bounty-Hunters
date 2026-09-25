<?php

namespace App\Services;

use App\Models\NotificationPreference;
use Illuminate\Support\Collection;

class NotificationRouter
{
    /**
     * Return the list of channels that should receive the notification
     * for the given user and event type.
     *
     * @param  \App\Models\User  $user
     * @param  string  $eventType
     * @return array
     */
    public function getEnabledChannels($user, string $eventType): array
    {
        return $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->toArray();
    }

    /**
     * Dispatch a notification to all enabled channels for the user.
     *
     * @param  \App\Models\User  $user
     * @param  string  $eventType
     * @param  array  $payload
     * @return void
     */
    public function dispatch($user, string $eventType, array $payload)
    {
        $channels = $this->getEnabledChannels($user, $eventType);

        foreach ($channels as $channel) {
            // Simplified dispatch logic – in a real app you would call
            // the appropriate notification channel here.
            // For example:
            // if ($channel === 'mail') { Mail::to($user)->send(new SomeMail($payload)); }
            // if ($channel === 'slack') { Slack::send($payload); }
            // if ($channel === 'database') { $user->notifications()->create([...]); }
        }
    }
}
