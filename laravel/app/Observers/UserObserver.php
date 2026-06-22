<?php

namespace App\Observers;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class UserObserver
{
    public function creating(User $user): void
    {
        if (empty($user->uuid)) {
            $user->uuid = (string) Str::uuid();
        }
    }

    public function created(User $user): void
    {
        Log::info("User created", ["id" => $user->id, "email" => $user->email]);
    }

    public function deleted(User $user): void
    {
        Log::info("User deleted", ["id" => $user->id, "email" => $user->email]);
    }
}
