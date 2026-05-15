<?php

namespace App\Models;

use Illuminate\Support\Facades\Hash;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

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
            'password' => 'hashed', // Keep for reads; writes handled by mutator
        ];
    }

    /**
     * Hash password with configured bcrypt rounds on set.
     */
    public function setPasswordAttribute(string $value): void
    {
        $rounds = config('hashing.bcrypt.rounds', 10);
        $this->attributes['password'] = Hash::make($value, ['rounds' => $rounds]);
    }
}
