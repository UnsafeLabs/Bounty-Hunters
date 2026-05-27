<?php

namespace App\Services;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Notification;
use App\Models\NotificationPreference;

class NotificationRouter
{
    public static function route($notifiable, $notification, $event_type)
    {
        // Get user's preferences for this event type
        $preferences = NotificationPreference::where('user_id', $notifiable->id)
            ->where('event_type', $event_type)
            ->where('enabled', true)
            ->get();

        // If no preferences found, send to all default channels
        if ($preferences->isEmpty()) {
            Notification::send($notifiable, $notification);
            return;
        }

        // Filter notification channels based on preferences
        $channels = $preferences->pluck('channel')->toArray();

        // Send notification only to enabled channels
        foreach ($channels as $channel) {
            if (method_exists($notification, 'to' . ucfirst($channel))) {
                Notification::send($notifiable, $notification->via([$channel]));
            }
        }
    }

    public static function shouldRoute($notifiable, $event_type)
    {
        return NotificationPreference::where('user_id', $notifiable->id)->where('event_type', $event_type)->exists();
    }
}