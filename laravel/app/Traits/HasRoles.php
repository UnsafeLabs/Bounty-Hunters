<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;

trait HasRoles
{
    public function roles(): MorphToMany
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles');
    }

    public function permissions(): MorphToMany
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions');
    }

    public function assignRole(string|Role|int $role): void
    {
        if (is_string($role)) {
            $role = Role::firstOrCreate(['name' => $role]);
        } elseif (is_int($role)) {
            $role = Role::findOrFail($role);
        }
        $this->roles()->syncWithoutDetaching([$role->id]);
    }

    public function removeRole(string|Role|int $role): void
    {
        if (is_string($role)) {
            $role = Role::where('name', $role)->first();
        } elseif (is_int($role)) {
            $role = Role::find($role);
        }
        if ($role) {
            $this->roles()->detach($role->id);
        }
    }

    public function hasRole(string|Role|int $role): bool
    {
        if (is_string($role)) {
            return $this->roles()->where('name', $role)->exists();
        }
        if (is_int($role)) {
            return $this->roles()->where('roles.id', $role)->exists();
        }
        return $this->roles()->where('roles.id', $role->id)->exists();
    }

    public function hasPermission(string|Permission $permission): bool
    {
        $permissionName = is_string($permission) ? $permission : $permission->name;
        if ($this->permissions()->where('name', $permissionName)->exists()) {
            return true;
        }
        return $this->roles()
            ->whereHas('permissions', fn ($q) => $q->where('name', $permissionName))
            ->exists();
    }

    public function getAllPermissions(): Collection
    {
        $directPermissions = $this->permissions()->get();
        $rolePermissions = $this->roles()->with('permissions')->get()
            ->pluck('permissions')->flatten();
        return $directPermissions->merge($rolePermissions)->unique('id');
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
}
