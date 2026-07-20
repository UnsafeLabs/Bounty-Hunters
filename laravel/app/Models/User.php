<?php

namespace App\Models;

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
     * Hash password using configured bcrypt rounds from config/hashing.php.
     */
    public function setPasswordAttribute(string $value): void
    {
        // Already-hashed bcrypt strings start with $2y$ / $2a$ / $2b$
        if (preg_match('/^\$2[ayb]\$/', $value) === 1) {
            $this->attributes['password'] = $value;
            return;
        }

        $rounds = (int) config('hashing.bcrypt.rounds', 12);
        $this->attributes['password'] = Hash::make($value, [
            'rounds' => $rounds,
        ]);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            // password uses setPasswordAttribute mutator (configured rounds)
        ];
    }
}
