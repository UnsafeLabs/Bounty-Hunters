<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Notifications\RoutedNotification;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;

class NotificationRouter
{
    /**
     * Return only channels enabled by the user for the given event type.
     *
     * @param  array<int, string>|null  $channels
     * @return array<int, string>
     */
    public function enabledChannels(User $user, string $eventType, ?array $channels = null): array
    {
        $candidateChannels = $channels ?? NotificationPreference::CHANNELS;

        return $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->whereIn('channel', $candidateChannels)
            ->orderByRaw("case channel when 'mail' then 1 when 'slack' then 2 when 'database' then 3 else 4 end")
            ->pluck('channel')
            ->all();
    }

    /**
     * Determine whether a channel is enabled for an event type.
     */
    public function shouldSend(User $user, string $eventType, string $channel): bool
    {
        return in_array($channel, $this->enabledChannels($user, $eventType, [$channel]), true);
    }

    /**
     * Dispatch a notification only through channels enabled for the event type.
     *
     * @param  array<int, string>|null  $channels
     * @return array<int, string> The channels used for dispatch.
     */
    public function send(User $user, string $eventType, Notification $notification, ?array $channels = null): array
    {
        $candidateChannels = $channels ?? $notification->via($user);
        $enabledChannels = $this->enabledChannels($user, $eventType, $candidateChannels);

        if ($enabledChannels !== []) {
            NotificationFacade::send($user, new RoutedNotification($notification, $enabledChannels));
        }

        return $enabledChannels;
    }
}
