<?php

namespace App\Observers;

use App\Models\User;
use App\Models\NotificationPreference;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class UserObserver
{
    public function creating(User $user): void
    {
        if (empty($user->uuid)) {
            $user->uuid = (string) Str::uuid();
        }
    }

    public function created(User $user): void
    {
        $channels = ["mail", "database"];
        $eventTypes = ["new_message", "system_alert", "weekly_digest"];
        foreach ($channels as $channel) {
            foreach ($eventTypes as $eventType) {
                NotificationPreference::create([
                    "user_id" => $user->id,
                    "channel" => $channel,
                    "event_type" => $eventType,
                    "enabled" => true,
                ]);
            }
        }

        Log::info("User created", ["id" => $user->id, "email" => $user->email]);
    }

    public function deleted(User $user): void
    {
        Log::info("User deleted", ["id" => $user->id, "email" => $user->email]);
    }
}
