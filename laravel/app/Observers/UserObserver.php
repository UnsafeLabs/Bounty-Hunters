<?php

namespace App\Observers;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class UserObserver
{
    /**
     * Handle the User "creating" event.
     */
    public function creating(User $user): void
    {
        if (empty($user->uuid)) {
            $user->uuid = (string) Str::uuid();
        }
    }

    /**
     * Handle the User "created" event.
     */
    public function created(User $user): void
    {
        Log::info('User created', ['id' => $user->id, 'uuid' => $user->uuid]);
    }

    /**
     * Handle the User "deleting" event.
     */
    public function deleting(User $user): void
    {
        Log::info('User deleting', ['id' => $user->id, 'uuid' => $user->uuid]);
    }
}
