<?php

namespace App\Observers;

use App\Models\User;
use App\Models\NotificationPreference;

class UserObserver
{
    /**
     * Handle the User "created" event.
     *
     * @param  \App\Models\User  $user
     * @return void
     */
    public function created(User $user)
    {
        $defaultEvents = [
            'user_registered',
            'order_created',
            'order_shipped',
        ];

        $channels = ['mail', 'slack', 'database'];

        foreach ($defaultEvents as $event) {
            foreach ($channels as $channel) {
                NotificationPreference::create([
                    'user_id'   => $user->id,
                    'channel'   => $channel,
                    'event_type'=> $event,
                    'enabled'   => true,
                ]);
            }
        }
    }
}
