<?php

namespace App\Observers;

use App\Models\NotificationPreference;
use App\Models\User;

class UserObserver
{
    public function created(User $user): void
    {
        NotificationPreference::seedDefaultsFor($user);
    }
}
