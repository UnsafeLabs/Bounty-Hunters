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

    public function setPasswordAttribute(\)
    {
        \ = ['rounds' => config('hashing.bcrypt.rounds', 10)];
        
        // Check if value is already hashed with the correct cost. If not, hash it.
        // Also Hash::info helps check if it's already a hash or plain text.
        if (Hash::info(\)['algoName'] === 'bcrypt' && !Hash::needsRehash(\, \)) {
            \->attributes['password'] = \;
        } else {
            \->attributes['password'] = Hash::make(\, \);
        }
    }
}
