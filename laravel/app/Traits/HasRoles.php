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
        $role = $this->resolveRole($role);
        $this->roles()->detach($role->getKey());

        return $this;
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permission = $this->resolvePermission($permission);
        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);

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

    protected function resolveRole(Role|string $role): Role
    {
        if ($role instanceof Role) {
            return $role;
        }

        return Role::query()->firstOrCreate([
            'name' => $role,
            'guard_name' => $this->getDefaultGuardName(),
        ]);
    }

    protected function resolvePermission(Permission|string $permission): Permission
    {
        if ($permission instanceof Permission) {
            return $permission;
        }

        return Permission::query()->firstOrCreate([
            'name' => $permission,
            'guard_name' => $this->getDefaultGuardName(),
        ]);
    }

    protected function getDefaultGuardName(): string
    {
        return config('auth.defaults.guard', 'web');
    }
}
