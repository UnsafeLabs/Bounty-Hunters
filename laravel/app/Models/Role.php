<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Role extends Model
{
    protected $fillable = ['name', 'guard_name'];

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }

    public function givePermissionTo(string|Permission $permission): void
    {
        if (is_string($permission)) {
            $permission = Permission::firstOrCreate(['name' => $permission]);
        }
        $this->permissions()->syncWithoutDetaching([$permission->id]);
    }

    public function revokePermissionTo(string|Permission $permission): void
    {
        if (is_string($permission)) {
            $permission = Permission::where('name', $permission)->first();
        }
        if ($permission) {
            $this->permissions()->detach($permission->id);
        }
    }

    public function hasPermissionTo(string|Permission $permission): bool
    {
        if (is_string($permission)) {
            return $this->permissions()->where('name', $permission)->exists();
        }
        return $this->permissions()->where('permissions.id', $permission->id)->exists();
    }
}
