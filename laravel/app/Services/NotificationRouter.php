<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;

class NotificationRouter
{
    public function shouldSendToChannel(User $user, string $channel, string $eventType): bool
    {
        $preference = NotificationPreference::where('user_id', $user->id)
            ->where('channel', $channel)
            ->where('event_type', $eventType)
            ->first();

        if (!$preference) {
            return false;
        }

        return $preference->enabled;
    }

    public function getEnabledChannels(User $user, string $eventType): array
    {
        return NotificationPreference::where('user_id', $user->id)
            ->where('event_type', $eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->toArray();
    }

    public function routeNotification(User $user, string $eventType, callable $sendCallback): void
    {
        $channels = $this->getEnabledChannels($user, $eventType);

        foreach ($channels as $channel) {
            $sendCallback($channel, $user);
        }
    }

    public static function createDefaultPreferences(int $userId): void
    {
        $channels = NotificationPreference::getDefaultChannels();
        $eventTypes = NotificationPreference::getDefaultEventTypes();

        foreach ($eventTypes as $eventType) {
            foreach ($channels as $channel) {
                NotificationPreference::firstOrCreate([
                    'user_id' => $userId,
                    'channel' => $channel,
                    'event_type' => $eventType,
                ], ['enabled' => true]);
            }
        }
    }
}