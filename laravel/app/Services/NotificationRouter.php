<?php

namespace App\Services;

use App\Models\User;
use InvalidArgumentException;

class NotificationRouter
{
    /**
     * Resolve the delivery channels a user should receive an event type on.
     *
     * A channel is delivered to when the user has a stored preference enabling
     * it. Channels with no stored row fall back to the configured defaults, so
     * a user without seeded preferences still receives the default channels.
     *
     * @return list<string>
     *
     * @throws InvalidArgumentException When the event type is not configured.
     */
    public static function channelsFor(User $user, string $eventType): array
    {
        $eventTypes = (array) config('notifications.event_types', []);

        if (! in_array($eventType, $eventTypes, true)) {
            throw new InvalidArgumentException("Unknown notification event type [{$eventType}].");
        }

        $channels = (array) config('notifications.channels', []);
        $defaults = (array) config('notifications.defaults', []);

        $stored = $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->pluck('enabled', 'channel');

        return array_values(array_filter(
            $channels,
            fn (string $channel): bool => $stored->has($channel)
                ? (bool) $stored->get($channel)
                : in_array($channel, $defaults, true),
        ));
    }

    /**
     * Determine whether a single channel is enabled for an event type.
     *
     * @throws InvalidArgumentException When the event type or channel is not configured.
     */
    public static function isEnabled(User $user, string $eventType, string $channel): bool
    {
        $channels = (array) config('notifications.channels', []);

        if (! in_array($channel, $channels, true)) {
            throw new InvalidArgumentException("Unknown notification channel [{$channel}].");
        }

        return in_array($channel, self::channelsFor($user, $eventType), true);
    }
}
