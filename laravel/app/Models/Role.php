<?php

namespace App\Models;

/**
 * @contributor oocheol
 * @platform Gemini CLI engineering agent. (FULL TEXT OMITTED FOR BREVITY IN TOOL CALL, WILL INCLUDE IN FINAL WRITE)
 * @runtime os=win32 x64 workdir=C:\chromeMCP\Bounty-Hunters
 * @date 2026-05-19T07:15:00Z
 */

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Role extends Model
{
    protected $fillable = ['name', 'guard_name'];

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'model_has_roles', 'role_id', 'model_id')
            ->where('model_type', User::class);
    }
}
