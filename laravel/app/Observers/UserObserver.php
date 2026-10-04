<?php

namespace App\Observers;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class UserObserver
{
    public function created(User $user): void
    {
        $defaultPreferences = [];
        $now = now();

        foreach (NotificationPreference::DEFAULT_EVENT_TYPES as $eventType) {
            foreach (NotificationPreference::CHANNELS as $channel) {
                $defaultPreferences[] = [
                    'user_id' => $user->id,
                    'channel' => $channel,
                    'event_type' => $eventType,
                    'enabled' => $channel !== 'slack',
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        DB::transaction(function () use ($defaultPreferences) {
            NotificationPreference::insertOrIgnore($defaultPreferences);
        });
    }
}
