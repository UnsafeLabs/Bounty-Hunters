<?php

namespace App\Services;

use App\Models\User;
use App\Notifications\BaseNotification;
use Illuminate\Support\Collection;

/**
 * NotificationRouter decides which channels a notification should be sent through
 * based on the user's stored NotificationPreference records.
 */
class NotificationRouter
{
    /**
     * Resolve the enabled channels for a given user and event type.
     *
     * @param User   $user
     * @param string $eventType
     *
     * @return string[] List of channel names (e.g., ['mail', 'database'])
     */
    public function resolveChannels(User $user, string $eventType): array
    {
        $prefs = $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->unique()
            ->toArray();

        // Fallback to default Laravel channels if none are explicitly enabled
        return $prefs ?: ['mail'];
    }

    /**
     * Dispatch a notification respecting the user's preferences.
     *
     * @param User   $user
     * @param string $eventType
     * @param BaseNotification $notification
     *
     * @return void
     */
    public function send(User $user, string $eventType, BaseNotification $notification): void
    {
        $channels = $this->resolveChannels($user, $eventType);
        $user->notify($notification->via($channels));
    }
}
