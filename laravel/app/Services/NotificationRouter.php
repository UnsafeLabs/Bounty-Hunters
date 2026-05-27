<?php

namespace App\Services;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class NotificationRouter
{
    public function shouldSendToChannel(User $user, string $channel, string $eventType): bool
    {
        $preference = NotificationPreference::forUser($user->id)
            ->forChannel($channel)
            ->forEventType($eventType)
            ->first();

        if (!$preference) {
            Log::warning("No notification preference found for user {$user->id}, channel {$channel}, event {$eventType}");
            return false;
        }

        return $preference->enabled;
    }

    public function getEnabledChannels(User $user, string $eventType): array
    {
        return NotificationPreference::forUser($user->id)
            ->forEventType($eventType)
            ->where('enabled', true)
            ->pluck('channel')
            ->toArray();
    }

    public function routeNotification(User $user, string $eventType, callable $sendCallback): void
    {
        $enabledChannels = $this->getEnabledChannels($user, $eventType);

        foreach ($enabledChannels as $channel) {
            try {
                $sendCallback($channel);
            } catch (\Exception $e) {
                Log::error("Failed to send notification to {$channel} for user {$user->id}: " . $e->getMessage());
            }
        }
    }
}