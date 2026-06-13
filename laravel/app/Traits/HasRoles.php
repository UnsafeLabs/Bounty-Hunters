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
        return $this->morphToMany(Role::class, 'model', 'model_has_roles')
            ->withTimestamps();
    }

    public function permissions(): MorphToMany
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions')
            ->withTimestamps();
    }

    public function assignRole(Role|string $role): static
    {
        $role = $this->resolveRole($role);

        $this->roles()->syncWithoutDetaching([$role->getKey()]);

        return $this;
    }

    public function removeRole(Role|string $role): static
    {
        $role = $this->resolveRole($role, failIfMissing: false);

        if ($role !== null) {
            $this->roles()->detach($role->getKey());
        }

        return $this;
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permission = $this->resolvePermission($permission);

        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);

        return $this;
    }

    public function revokePermissionTo(Permission|string $permission): static
    {
        $permission = $this->resolvePermission($permission, failIfMissing: false);

        if ($permission !== null) {
            $this->permissions()->detach($permission->getKey());
        }

        return $this;
    }

    public function hasRole(Role|string $role): bool
    {
        $roleName = $role instanceof Role ? $role->name : $role;

        return $this->roles()
            ->where('name', $roleName)
            ->exists();
    }

    public function hasPermission(Permission|string $permission): bool
    {
        $permissionName = $permission instanceof Permission ? $permission->name : $permission;

        if ($this->permissions()->where('name', $permissionName)->exists()) {
            return true;
        }

        return $this->roles()
            ->whereHas('permissions', fn ($query) => $query->where('name', $permissionName))
            ->exists();
    }

    public function getAllPermissions(): Collection
    {
        $direct = $this->permissions()->get();
        $roleIds = $this->roles()->pluck('roles.id');
        $viaRoles = Permission::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('roles.id', $roleIds))
            ->get();

        return $direct
            ->merge($viaRoles)
            ->unique('id')
            ->values();
    }

    protected function resolveRole(Role|string $role, bool $failIfMissing = true): ?Role
    {
        if ($role instanceof Role) {
            return $role;
        }

        $query = Role::query()->where('name', $role);

        return $failIfMissing ? $query->firstOrFail() : $query->first();
    }

    protected function resolvePermission(Permission|string $permission, bool $failIfMissing = true): ?Permission
    {
        if ($permission instanceof Permission) {
            return $permission;
        }

        $query = Permission::query()->where('name', $permission);

        return $failIfMissing ? $query->firstOrFail() : $query->first();
    }
}
