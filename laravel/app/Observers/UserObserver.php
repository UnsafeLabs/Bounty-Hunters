<?php

namespace App\Observers;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class UserObserver
{
    /**
     * Assign a UUID before a user is created and log the creation event.
     */
    public function creating(User $user): void
    {
        if (blank($user->uuid)) {
            $user->uuid = (string) Str::uuid();
        }

        Log::info('User creating', [
            'uuid' => $user->uuid,
            'email' => $user->email,
        ]);
    }

    /**
     * Log the deletion event.
     */
    public function deleting(User $user): void
    {
        Log::info('User deleting', [
            'id' => $user->getKey(),
            'email' => $user->email,
        ]);
    }
}
