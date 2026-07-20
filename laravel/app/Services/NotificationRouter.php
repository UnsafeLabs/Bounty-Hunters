<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Support\Collection;

class NotificationRouter
{
    /**
     * Channels the user has enabled for a given event type.
     *
     * @return list<string>
     */
    public function enabledChannels(User $user, string $eventType): array
    {
        return NotificationPreference::query()
            ->where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Whether the user wants this event on the given channel.
     */
    public function shouldSend(User $user, string $eventType, string $channel): bool
    {
        $pref = NotificationPreference::query()
            ->where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->first();

        // No preference row: do not send (explicit opt-in model after seed)
        if (! $pref) {
            return false;
        }

        return (bool) $pref->enabled;
    }

    /**
     * Filter a candidate channel list by user preferences.
     *
     * @param  list<string>  $channels
     * @return list<string>
     */
    public function filterChannels(User $user, string $eventType, array $channels): array
    {
        return array_values(array_filter(
            $channels,
            fn (string $ch) => $this->shouldSend($user, $eventType, $ch)
        ));
    }

    /**
     * Default preferences seeded for new users.
     *
     * @return list<array{channel:string,event_type:string,enabled:bool}>
     */
    public static function defaultPreferences(): array
    {
        $events = ['account.security', 'billing.invoice', 'product.updates'];
        $channels = NotificationPreference::CHANNELS;
        $rows = [];
        foreach ($events as $event) {
            foreach ($channels as $channel) {
                $rows[] = [
                    'channel' => $channel,
                    'event_type' => $event,
                    'enabled' => $channel === 'mail', // mail on by default
                ];
            }
        }

        return $rows;
    }

    public function seedDefaults(User $user): Collection
    {
        $created = collect();
        foreach (self::defaultPreferences() as $row) {
            $created->push(NotificationPreference::query()->firstOrCreate(
                [
                    'user_id' => $user->id,
                    'channel' => $row['channel'],
                    'event_type' => $row['event_type'],
                ],
                ['enabled' => $row['enabled']]
            ));
        }

        return $created;
    }
}
