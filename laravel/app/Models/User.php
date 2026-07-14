<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function createToken(string $name): object
    {
        $tokenString = Str::random(64);
        $this->forceFill([
            'remember_token' => hash('sha256', $tokenString),
        ])->save();

        return new class($tokenString)
        {
            public string $plainTextToken;
            public function __construct(string $token)
            {
                $this->plainTextToken = $token;
            }
        };
    }

    public function currentAccessToken(): ?object
    {
        return null;
    }
}
