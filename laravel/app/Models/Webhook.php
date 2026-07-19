<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Webhook extends Model
{
    use HasFactory;

    protected $fillable = [
        'url',
        'event',
        'secret',
        'active',
        'success_count',
        'failure_count',
    ];

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'success_count' => 'integer',
            'failure_count' => 'integer',
        ];
    }
}
