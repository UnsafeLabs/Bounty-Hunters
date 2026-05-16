<?php

namespace App\Observers;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class UserObserver
{
    public function creating(User $user): void
    {
        if (blank($user->uuid)) {
            $user->uuid = (string) Str::uuid();
        }
    }

    public function created(User $user): void
    {
        Log::info('User created', [
            'user_id' => $user->getKey(),
            'uuid' => $user->uuid,
            'email' => $user->email,
        ]);
    }

    public function deleted(User $user): void
    {
        Log::info('User deleted', [
            'user_id' => $user->getKey(),
            'uuid' => $user->uuid,
            'email' => $user->email,
        ]);
    }
}
