<?php

namespace App\Services;

use App\Models\NotificationPreference;
use Illuminate\Support\Facades\Notification;

class NotificationRouter
{
    public function route($notifiable, $notification, $eventType)
    {
        // Get user's enabled channels for this event type
        $enabledPreferences = NotificationPreference::where('user_id', $notifiable->id)
            ->where('event_type', $eventType)
            ->enabled()
            ->get();

        $enabledChannels = $enabledPreferences->pluck('channel')->toArray();

        // If no preferences found, send to all channels by default
        if ($enabledPreferences->isEmpty()) {
            Notification::send($notifiable, $notification);
            return;
        }

        // Send to enabled channels only
        foreach ($enabledChannels as $channel) {
            switch ($channel) {
                case 'mail':
                    Notification::send($notifiable, $notification->toMail($notifiable));
                    break;
                case 'slack':
                    Notification::send($notifiable, $notification->toSlack($notifiable));
                    break;
                case 'database':
                    $notifiable->notify($notification);
                    break;
            }
        }
    }
}