<?php

namespace App\Services;

use App\Models\NotificationPreference;
use Illuminate\Support\Facades\Log;

class NotificationRouter
{
    public function route($user, $eventType, $channels)
    {
        $enabledChannels = [];
        
        foreach ($channels as $channel) {
            $preference = NotificationPreference::where([
                'user_id' => $user->id,
                'channel' => $channel,
                'event_type' => $eventType
            ])->first();
            
            // If preference exists and is enabled, or if no preference exists (default to enabled)
            if (($preference && $preference->enabled) || (!$preference)) {
                $enabledChannels[] = $channel;
            }
        }
        
        return $enabledChannels;
    }
    
    public function shouldSend($user, $channel, $eventType)
    {
        $preference = NotificationPreference::where([
            'user_id' => $user->id,
            'channel' => $channel,
            'event_type' => $eventType
        ])->first();
        
        return ($preference && $preference->enabled) || (!$preference);
    }
}