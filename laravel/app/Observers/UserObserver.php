<?php

namespace App\Observers;

use App\Models\NotificationPreference;
use App\Models\User;

class UserObserver
{
    public function created(User $user): void
    {
        $defaultPreferences = [
            ['channel' => 'mail', 'event_type' => 'order_created', 'enabled' => true],
            ['channel' => 'mail', 'event_type' => 'order_shipped', 'enabled' => true],
            ['channel' => 'mail', 'event_type' => 'order_delivered', 'enabled' => true],
            ['channel' => 'mail', 'event_type' => 'payment_received', 'enabled' => true],
            ['channel' => 'mail', 'event_type' => 'account_updated', 'enabled' => true],
            ['channel' => 'database', 'event_type' => 'order_created', 'enabled' => true],
            ['channel' => 'database', 'event_type' => 'order_shipped', 'enabled' => true],
            ['channel' => 'database', 'event_type' => 'order_delivered', 'enabled' => true],
            ['channel' => 'database', 'event_type' => 'payment_received', 'enabled' => true],
            ['channel' => 'database', 'event_type' => 'account_updated', 'enabled' => true],
            ['channel' => 'slack', 'event_type' => 'order_created', 'enabled' => false],
            ['channel' => 'slack', 'event_type' => 'order_shipped', 'enabled' => false],
            ['channel' => 'slack', 'event_type' => 'order_delivered', 'enabled' => false],
            ['channel' => 'slack', 'event_type' => 'payment_received', 'enabled' => false],
            ['channel' => 'slack', 'event_type' => 'account_updated', 'enabled' => false],
        ];

        foreach ($defaultPreferences as $pref) {
            NotificationPreference::create([
                'user_id' => $user->id,
                'channel' => $pref['channel'],
                'event_type' => $pref['event_type'],
                'enabled' => $pref['enabled'],
            ]);
        }
    }
}