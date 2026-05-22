<?php

namespace App\Models;

class Permission extends Model
{
    protected $fillable = [
        'name',
        'guard_name',
    ];

    public $timestamps = false;
}