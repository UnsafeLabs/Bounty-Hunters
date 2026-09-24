<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;

/**
 * Lightweight role/permission support for Eloquent models.
 *
 * Roles and permissions are plain rows; a model may hold roles and direct
 * permissions, and inherits permissions granted to its roles.
 */
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

    /**
     * Assign a role by name or model. Idempotent.
     */
    public function assignRole(string|Role $role): static
    {
        $this->roles()->syncWithoutDetaching([$this->resolveRole($role)->getKey()]);
        $this->unsetRelation('roles');

        return $this;
    }

    /**
     * Remove a role by name or model.
     */
    public function removeRole(string|Role $role): static
    {
        $this->roles()->detach($this->resolveRole($role)->getKey());
        $this->unsetRelation('roles');

        return $this;
    }

    public function hasRole(string|Role $role): bool
    {
        $name = $role instanceof Role ? $role->name : $role;

        return $this->roles()->where('name', $name)->exists();
    }

    /**
     * True when the model holds the permission directly or through any role.
     */
    public function hasPermission(string|Permission $permission): bool
    {
        $name = $permission instanceof Permission ? $permission->name : $permission;

        if ($this->permissions()->where('name', $name)->exists()) {
            return true;
        }

        return $this->getAllPermissions()->contains(
            fn (Permission $held) => $held->name === $name
        );
    }

    /**
     * Merge directly assigned permissions with those inherited from roles.
     *
     * @return Collection<int, Permission>
     */
    public function getAllPermissions(): Collection
    {
        $direct = $this->permissions()->get();

        $inherited = $this->roles()
            ->with('permissions')
            ->get()
            ->flatMap(fn (Role $role) => $role->permissions);

        return $direct->merge($inherited)->unique('id')->values();
    }

    protected function resolveRole(string|Role $role): Role
    {
        return $role instanceof Role
            ? $role
            : Role::where('name', $role)->firstOrFail();
    }
}
