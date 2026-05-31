<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Support\Facades\Notification;

class NotificationRouter
{
    /**
     * @param  array<int, string>  $candidateChannels
     * @return array<int, string>
     */
    public function channelsFor(User $user, string $eventType, array $candidateChannels = NotificationPreference::CHANNELS): array
    {
        return $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->whereIn('channel', $candidateChannels)
            ->where('enabled', true)
            ->orderBy('channel')
            ->pluck('channel')
            ->all();
    }

    public function shouldSend(User $user, string $eventType, string $channel): bool
    {
        return in_array($channel, $this->channelsFor($user, $eventType, [$channel]), true);
    }

    /**
     * @param  array<int, string>  $candidateChannels
     * @return array<int, string>
     */
    public function send(User $user, string $eventType, object $notification, array $candidateChannels = NotificationPreference::CHANNELS): array
    {
        $channels = $this->channelsFor($user, $eventType, $candidateChannels);

        if ($channels !== []) {
            Notification::sendNow($user, $notification, $channels);
        }

        return $channels;
    }
}
