<?php

namespace App\Services;

use App\Models\NotificationPreference;
use Illuminate\Support\Facades\Log;

class NotificationRouter
{
    public function shouldSend(int $userId, string $channel, string $eventType): bool
    {
        $preference = NotificationPreference::where('user_id', $userId)
            ->where('channel', $channel)
            ->where('event_type', $eventType)
            ->first();

        if (!$preference) {
            return true;
        }

        return $preference->enabled;
    }

    public function getEnabledChannels(int $userId, string $eventType): array
    {
        $preferences = NotificationPreference::where('user_id', $userId)
            ->where('event_type', $eventType)
            ->get();

        return $preferences
            ->filter(fn($p) => $p->enabled)
            ->pluck('channel')
            ->toArray();
    }

    public function route(int $userId, string $eventType, array $channels, callable $sendCallback): array
    {
        $results = [];

        foreach ($channels as $channel) {
            if ($this->shouldSend($userId, $channel, $eventType)) {
                try {
                    $results[$channel] = $sendCallback($channel);
                } catch (\Throwable $e) {
                    Log::error("Notification failed for channel {$channel}", [
                        'user_id' => $userId,
                        'event_type' => $eventType,
                        'error' => $e->getMessage(),
                    ]);
                    $results[$channel] = false;
                }
            } else {
                $results[$channel] = 'skipped';
            }
        }

        return $results;
    }
}
