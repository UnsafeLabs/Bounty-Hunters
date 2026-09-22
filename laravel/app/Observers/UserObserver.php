<?php

namespace App\Observers;

use App\Models\User;
use App\Models\NotificationPreference;

/**
 * Seeds default notification preferences when a new user is created.
 */
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
        $defaultChannels = ['mail', 'slack', 'database'];
        $defaultEvents   = ['order_created', 'order_shipped', 'password_changed'];

        foreach ($defaultEvents as $event) {
            foreach ($defaultChannels as $channel) {
                NotificationPreference::create([
                    'user_id'    => $user->id,
                    'channel'    => $channel,
                    'event_type' => $event,
                    'enabled'    => true,
                ]);
            }
        }
    }
}
