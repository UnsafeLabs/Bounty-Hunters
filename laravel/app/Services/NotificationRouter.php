<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Notifications\Notification;

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

    public function filterChannelsForNotification(User $user, Notification $notification, array $channels): array
    {
        $eventType = $this->getEventTypeFromNotification($notification);
        
        if (empty($eventType)) {
            return $channels;
        }

        $enabledChannels = $this->getEnabledChannels($user, $eventType);
        
        if (empty($enabledChannels)) {
            return [];
        }

        return array_values(array_intersect($channels, $enabledChannels));
    }

    public function shouldSendToChannel(User $user, Notification $notification, string $channel): bool
    {
        $eventType = $this->getEventTypeFromNotification($notification);
        
        if (empty($eventType)) {
            return true;
        }

        return $this->isChannelEnabled($user, $eventType, $channel);
    }

    protected function getEventTypeFromNotification(Notification $notification): ?string
    {
        if (method_exists($notification, 'getEventType')) {
            return $notification->getEventType();
        }

        if (property_exists($notification, 'eventType')) {
            return $notification->eventType;
        }

        return class_basename($notification);
    }
}