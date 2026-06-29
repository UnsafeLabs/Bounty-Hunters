<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Support\Collection;

class NotificationRouter
{
    public const DEFAULT_EVENT_TYPES = [
        'account.created',
        'security.alert',
        'billing.updated',
    ];

    /**
     * @param array<int, string> $channels
     *
     * @return array<int, string>
     */
    public function enabledChannelsFor(User $user, string $eventType, array $channels = NotificationPreference::CHANNELS): array
    {
        $preferences = $this->preferencesFor($user, $eventType)
            ->keyBy('channel');

        return array_values(array_filter(
            $channels,
            fn (string $channel): bool => (bool) ($preferences->get($channel)?->enabled ?? false)
        ));
    }

    public function shouldSend(User $user, string $eventType, string $channel): bool
    {
        return in_array($channel, $this->enabledChannelsFor($user, $eventType, [$channel]), true);
    }

    /**
     * @param array<int, string> $candidateChannels
     * @param callable(string): void $send
     *
     * @return array<int, string>
     */
    public function dispatch(User $user, string $eventType, array $candidateChannels, callable $send): array
    {
        $enabledChannels = $this->enabledChannelsFor($user, $eventType, $candidateChannels);

        foreach ($enabledChannels as $channel) {
            $send($channel);
        }

        return $enabledChannels;
    }

    public function seedDefaults(User $user): void
    {
        foreach (self::DEFAULT_EVENT_TYPES as $eventType) {
            foreach (NotificationPreference::CHANNELS as $channel) {
                NotificationPreference::query()->firstOrCreate(
                    [
                        'user_id' => $user->id,
                        'channel' => $channel,
                        'event_type' => $eventType,
                    ],
                    [
                        'enabled' => $channel !== NotificationPreference::CHANNEL_SLACK,
                    ]
                );
            }
        }
    }

    /**
     * @return Collection<int, NotificationPreference>
     */
    private function preferencesFor(User $user, string $eventType): Collection
    {
        return $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->get();
    }
}
