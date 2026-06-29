<?php

namespace App\Observers;

use App\Models\User;
use App\Services\NotificationRouter;

class UserObserver
{
    public function created(User $user): void
    {
        app(NotificationRouter::class)->seedDefaults($user);
    }
}
