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

    public function setPasswordAttribute(?string $password): void
    {
        if ($password === null || $password === '') {
            $this->attributes['password'] = $password;

            return;
        }

        if (password_get_info($password)['algoName'] !== 'unknown') {
            $this->attributes['password'] = $password;

            return;
        }

        $rounds = (int) config('hashing.bcrypt.rounds');

        $this->attributes['password'] = Hash::make($password, [
            'rounds' => $rounds,
        ]);
    }
}
