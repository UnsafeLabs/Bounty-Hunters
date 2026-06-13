<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\MorphToMany;

class Role extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'guard_name',
    ];

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions')
            ->withTimestamps();
    }

    public function users(): MorphToMany
    {
        return $this->morphedByMany(User::class, 'model', 'model_has_roles')
            ->withTimestamps();
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permission = $permission instanceof Permission
            ? $permission
            : Permission::query()->where('name', $permission)->firstOrFail();

        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);

        return $this;
    }

    public function revokePermissionTo(Permission|string $permission): static
    {
        $permission = $permission instanceof Permission
            ? $permission
            : Permission::query()->where('name', $permission)->first();

        if ($permission !== null) {
            $this->permissions()->detach($permission->getKey());
        }

        return $this;
    }

    public function hasPermission(Permission|string $permission): bool
    {
        $permissionName = $permission instanceof Permission ? $permission->name : $permission;

        return $this->permissions()
            ->where('name', $permissionName)
            ->exists();
    }
}
