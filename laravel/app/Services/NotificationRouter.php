<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use InvalidArgumentException;

class NotificationRouter
{
    public function shouldSend(User $user, string $eventType, string $channel): bool
    {
        $this->assertSupportedChannel($channel);

        $enabled = NotificationPreference::query()
            ->whereBelongsTo($user)
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->value('enabled');

        return $enabled === null ? false : (bool) $enabled;
    }

    /**
     * @param array<int, string> $channels
     * @return array<int, string>
     */
    public function enabledChannels(User $user, string $eventType, array $channels): array
    {
        return array_values(array_filter(
            $channels,
            fn (string $channel): bool => $this->shouldSend($user, $eventType, $channel),
        ));
    }

    /**
     * @param array<int, string> $channels
     * @return array<int, string>
     */
    public function getEnabledChannels(User $user, string $eventType, array $channels): array
    {
        return $this->enabledChannels($user, $eventType, $channels);
    }

    /**
     * @param array<int, string>|null $channels
     */
    public function route(User $user, Notification $notification, string $eventType, ?array $channels = null): void
    {
        $channels ??= $notification->via($user);
        $enabledChannels = $this->enabledChannels($user, $eventType, $channels);

        if ($enabledChannels === []) {
            return;
        }

        NotificationFacade::sendNow($user, $notification, $enabledChannels);
    }

    private function assertSupportedChannel(string $channel): void
    {
        if (! in_array($channel, NotificationPreference::CHANNELS, true)) {
            throw new InvalidArgumentException("Unsupported notification channel [{$channel}].");
        }
    }
}
