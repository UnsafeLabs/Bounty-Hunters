<?php

namespace App\Observers;

use App\Models\User;
use Illuminate\Support\Str;

class UserObserver
{
    public function creating(User $user): void
    {
        if (empty($user->uuid)) {
            $user->uuid = Str::uuid()->toString();
        }
    }
}
