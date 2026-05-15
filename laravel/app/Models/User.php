<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Hash;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
        ];
    }

    /**
     * Hash the password with the configured bcrypt rounds.
     *
     * Replaces the generic 'hashed' cast so that config('hashing.bcrypt.rounds')
     * is respected instead of always using the default 10 rounds.
     */
    protected function setPasswordAttribute(?string $value): void
    {
        if ($value !== null) {
            $rounds = (int) config('hashing.bcrypt.rounds', 10);
            $this->attributes['password'] = Hash::make($value, ['rounds' => $rounds]);
        }
    }
}
