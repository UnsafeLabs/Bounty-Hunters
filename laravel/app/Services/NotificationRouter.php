<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;

class NotificationRouter
{
    public function getEnabledChannels(User $user, string $eventType): array
    {
        return NotificationPreference::where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->toArray();
    }

    public function isChannelEnabled(User $user, string $eventType, string $channel): bool
    {
        return NotificationPreference::where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->where('enabled', true)
            ->exists();
    }

    public function filterChannels(User $user, string $eventType, array $channels): array
    {
        $enabledChannels = $this->getEnabledChannels($user, $eventType);

        return array_values(array_intersect($channels, $enabledChannels));
    }

    public function send(User $user, Notification $notification, string $eventType): void
    {
        $channels = $this->filterChannels($user, $eventType, $notification->via($user));

        if ($channels !== []) {
            NotificationFacade::sendNow($user, $notification, $channels);
        }
    }
}
