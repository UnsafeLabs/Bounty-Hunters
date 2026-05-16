<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Permission extends Model
{
    protected $fillable = ['name', 'guard_name'];

    protected $hidden = ['pivot'];

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'role_has_permissions');
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(config('auth.providers.users.model', User::class), 'model_has_permissions', 'permission_id', 'model_id');
    }
}