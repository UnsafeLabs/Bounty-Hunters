<?php

namespace App\Observers;

use App\Models\User;
use App\Services\NotificationRouter;

class UserObserver
{
    public function __construct(
        private readonly NotificationRouter $router = new NotificationRouter(),
    ) {}

    public function created(User $user): void
    {
        $this->router->seedDefaults($user);
    }
}
