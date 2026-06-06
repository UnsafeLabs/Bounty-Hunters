<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;

trait HasRoles
{
    /**
     * @return MorphToMany<Role, $this>
     */
    public function roles(): MorphToMany
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles')
            ->withTimestamps();
    }

    /**
     * @return MorphToMany<Permission, $this>
     */
    public function permissions(): MorphToMany
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions')
            ->withTimestamps();
    }

    public function assignRole(string|Role $role): static
    {
        $role = $this->resolveRole($role);
        $this->roles()->syncWithoutDetaching([$role->getKey()]);
        $this->unsetRelation('roles');

        return $this;
    }

    public function removeRole(string|Role $role): static
    {
        $role = $this->resolveRole($role);
        $this->roles()->detach($role->getKey());
        $this->unsetRelation('roles');

        return $this;
    }

    public function hasRole(string|Role $role): bool
    {
        $roleName = $role instanceof Role ? $role->name : $role;

        return $this->roles()
            ->where('name', $roleName)
            ->exists();
    }

    public function givePermissionTo(string|Permission $permission): static
    {
        $permission = $this->resolvePermission($permission);
        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);
        $this->unsetRelation('permissions');

        return $this;
    }

    public function revokePermissionTo(string|Permission $permission): static
    {
        $permission = $this->resolvePermission($permission);
        $this->permissions()->detach($permission->getKey());
        $this->unsetRelation('permissions');

        return $this;
    }

    public function hasPermission(string|Permission $permission): bool
    {
        $permissionName = $permission instanceof Permission ? $permission->name : $permission;

        return $this->getAllPermissions()
            ->contains(fn (Permission $item): bool => $item->name === $permissionName);
    }

    /**
     * @return Collection<int, Permission>
     */
    public function getAllPermissions(): Collection
    {
        $direct = $this->permissions()->get();
        $viaRoles = $this->roles()
            ->with('permissions')
            ->get()
            ->flatMap(fn (Role $role): EloquentCollection => $role->permissions);

        return $direct
            ->concat($viaRoles)
            ->unique('id')
            ->values();
    }

    protected function resolveRole(string|Role $role): Role
    {
        if ($role instanceof Role) {
            return $role;
        }

        return Role::firstOrCreate([
            'name' => $role,
            'guard_name' => 'web',
        ]);
    }

    protected function resolvePermission(string|Permission $permission): Permission
    {
        if ($permission instanceof Permission) {
            return $permission;
        }

        return Permission::firstOrCreate([
            'name' => $permission,
            'guard_name' => 'web',
        ]);
    }
}
