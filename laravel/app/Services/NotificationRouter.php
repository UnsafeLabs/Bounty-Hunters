<?php

namespace App\Services;

use App\Models\User;

class NotificationRouter
{
    /**
     * @param array<int, string> $candidateChannels
     * @return array<int, string>
     */
    public function enabledChannels(User $user, string $eventType, array $candidateChannels): array
    {
        $enabled = $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->whereIn('channel', $candidateChannels)
            ->pluck('channel')
            ->all();

        return array_values(array_intersect($candidateChannels, $enabled));
    }

    public function shouldSend(User $user, string $eventType, string $channel): bool
    {
        return $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->where('enabled', true)
            ->exists();
    }
}
