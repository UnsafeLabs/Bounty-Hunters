<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;
use InvalidArgumentException;

trait HasRoles
{
    public function roles(): MorphToMany
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles')->withTimestamps();
    }

    public function permissions(): MorphToMany
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions')->withTimestamps();
    }

    public function assignRole(Role|string $role): static
    {
        $this->roles()->syncWithoutDetaching([$this->resolveRole($role)->getKey()]);

        return $this;
    }

    public function removeRole(Role|string $role): static
    {
        $this->roles()->detach($this->resolveRole($role)->getKey());

        return $this;
    }

    public function hasRole(Role|string $role): bool
    {
        $role = $role instanceof Role ? $role->name : $role;

        return $this->roles()->where('name', $role)->exists();
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

    /**
     * @return Collection<int, Permission>
     */
    public function getAllPermissions(): Collection
    {
        $directPermissions = $this->permissions()->get();
        $rolePermissions = $this->roles()
            ->with('permissions')
            ->get()
            ->flatMap(fn (Role $role) => $role->permissions);

        return $directPermissions
            ->merge($rolePermissions)
            ->unique('id')
            ->values();
    }

    private function resolveRole(Role|string $role): Role
    {
        if ($role instanceof Role) {
            return $role;
        }

        $resolvedRole = Role::where('name', $role)->first();

        if (! $resolvedRole) {
            throw new InvalidArgumentException("Role [{$role}] does not exist.");
        }

        return $resolvedRole;
    }
}
