<?php

namespace App\Observers;

use App\Models\NotificationPreference;
use App\Models\User;

class UserObserver
{
    /**
     * Seed notification preferences when a user is created.
     */
    public function created(User $user): void
    {
        NotificationPreference::seedDefaultsFor($user);
    }
}
