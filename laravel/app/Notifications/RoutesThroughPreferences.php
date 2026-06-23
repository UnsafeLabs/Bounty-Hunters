<?php

namespace App\Notifications;

use App\Models\User;
use App\Services\NotificationRouter;

/**
 * Routes a notification through the channels the recipient has enabled for its
 * event type. Apply to any Illuminate notification and implement {@see eventType()}.
 */
trait RoutesThroughPreferences
{
    /**
     * Get the delivery channels for the given notifiable.
     *
     * @return list<string>
     */
    public function via(User $notifiable): array
    {
        return NotificationRouter::channelsFor($notifiable, $this->eventType());
    }

    /**
     * The configured event type used to look up the recipient's preferences.
     */
    abstract public function eventType(): string;
}
