<?php

namespace App\Observers;

use App\Models\User;
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
        logger()->info('user.created', ['id' => $user->id, 'uuid' => $user->uuid ?? null]);
    }

    public function deleted(User $user): void
    {
        logger()->info('user.deleted', ['id' => $user->id, 'uuid' => $user->uuid ?? null]);
    }
}
