<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;

class NotificationRouter
{
    /**
     * @param  array<int, string>  $channels
     * @return array<int, string>
     */
    public function enabledChannels(User $user, string $eventType, array $channels = NotificationPreference::CHANNELS): array
    {
        $allowed = NotificationPreference::query()
            ->where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->whereIn('channel', $channels)
            ->pluck('channel')
            ->all();

        return array_values(array_intersect($channels, $allowed));
    }

    /**
     * @param  array<int, string>  $channels
     * @return array<int, string>
     */
    public function dispatch(User $user, string $eventType, array $channels, callable $dispatcher): array
    {
        $sent = [];

        foreach ($this->enabledChannels($user, $eventType, $channels) as $channel) {
            $dispatcher($channel, $user, $eventType);
            $sent[] = $channel;
        }

        return $sent;
    }
}
