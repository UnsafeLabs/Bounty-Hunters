<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Collection;

class NotificationRouter
{
    /**
     * @return array<int, string>
     */
    public function channelsFor(User $user, string $eventType): array
    {
        return NotificationPreference::query()
            ->where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->values()
            ->all();
    }

    public function enabled(User $user, string $eventType, string $channel): bool
    {
        return NotificationPreference::query()
            ->where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->where('enabled', true)
            ->exists();
    }

    public function route(User $user, string $eventType, Notification $notification): Collection
    {
        return collect($this->channelsFor($user, $eventType))
            ->mapWithKeys(fn (string $channel) => [$channel => $notification]);
    }
}
