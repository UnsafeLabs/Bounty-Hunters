<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;
use InvalidArgumentException;

/**
 * Adds lightweight role-based access control to an Eloquent model.
 *
 * A model may be assigned roles (which group permissions) and may also be
 * granted permissions directly. A model "has" a permission when it is granted
 * directly (model_has_permissions) or inherited through any assigned role.
 */
trait HasRoles
{
    /**
     * The roles assigned to the model.
     *
     * @return MorphToMany<Role, $this>
     */
    public function roles(): MorphToMany
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles');
    }

    /**
     * The permissions granted directly to the model (not via a role).
     *
     * @return MorphToMany<Permission, $this>
     */
    public function permissions(): MorphToMany
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions');
    }

    /**
     * Assign the given role(s) to the model. Existing assignments are kept.
     */
    public function assignRole(Role|string|int ...$roles): static
    {
        $ids = $this->resolveRoles($roles);

        if ($ids->isNotEmpty()) {
            $this->roles()->syncWithoutDetaching($ids->all());
            $this->unsetRelation('roles');
        }

        return $this;
    }

    /**
     * Remove the given role from the model.
     */
    public function removeRole(Role|string|int $role): static
    {
        $this->roles()->detach($this->resolveRoles([$role])->all());
        $this->unsetRelation('roles');

        return $this;
    }

    /**
     * Replace the model's roles with exactly the given role(s).
     */
    public function syncRoles(Role|string|int ...$roles): static
    {
        $this->roles()->sync($this->resolveRoles($roles)->all());
        $this->unsetRelation('roles');

        return $this;
    }

    /**
     * Determine whether the model is assigned the given role.
     */
    public function hasRole(Role|string|int $role): bool
    {
        if ($role instanceof Role) {
            return $this->roles->contains(fn (Role $assigned) => $assigned->getKey() === $role->getKey());
        }

        if (is_numeric($role)) {
            return $this->roles->contains(fn (Role $assigned) => (int) $assigned->getKey() === (int) $role);
        }

        return $this->roles->contains(fn (Role $assigned) => $assigned->name === $role);
    }

    /**
     * Determine whether the model is assigned at least one of the given roles.
     */
    public function hasAnyRole(Role|string|int ...$roles): bool
    {
        return collect($roles)->flatten()->contains(fn ($role) => $this->hasRole($role));
    }

    /**
     * Determine whether the model is assigned every one of the given roles.
     */
    public function hasAllRoles(Role|string|int ...$roles): bool
    {
        $roles = collect($roles)->flatten();

        return $roles->isNotEmpty() && $roles->every(fn ($role) => $this->hasRole($role));
    }

    /**
     * Grant the given permission(s) directly to the model.
     */
    public function givePermissionTo(Permission|string|int ...$permissions): static
    {
        $ids = $this->resolvePermissions($permissions);

        if ($ids->isNotEmpty()) {
            $this->permissions()->syncWithoutDetaching($ids->all());
            $this->unsetRelation('permissions');
        }

        return $this;
    }

    /**
     * Revoke a directly granted permission from the model.
     */
    public function revokePermissionTo(Permission|string|int $permission): static
    {
        $this->permissions()->detach($this->resolvePermissions([$permission])->all());
        $this->unsetRelation('permissions');

        return $this;
    }

    /**
     * Get every unique permission the model has, merging permissions granted
     * directly (model_has_permissions) with those inherited through its roles.
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

    /**
     * Determine whether the model has the given permission, either directly or
     * inherited through one of its roles.
     */
    public function hasPermission(Permission|string $permission): bool
    {
        $name = $permission instanceof Permission ? $permission->name : $permission;

        return $this->getAllPermissions()->contains(fn (Permission $granted) => $granted->name === $name);
    }

    /**
     * Resolve the given roles to a collection of unique primary keys.
     *
     * @param  array<int, Role|string|int>  $roles
     * @return Collection<int, int>
     */
    protected function resolveRoles(array $roles): Collection
    {
        return collect($roles)
            ->flatten()
            ->reject(fn ($role) => $role === null || $role === '')
            ->map(function (Role|string|int $role) {
                if ($role instanceof Role) {
                    return $role->getKey();
                }

                $model = is_numeric($role)
                    ? Role::find($role)
                    : Role::where('name', $role)->first();

                if ($model === null) {
                    throw new InvalidArgumentException("Role [{$role}] does not exist.");
                }

                return $model->getKey();
            })
            ->unique()
            ->values();
    }

    /**
     * Resolve the given permissions to a collection of unique primary keys.
     *
     * @param  array<int, Permission|string|int>  $permissions
     * @return Collection<int, int>
     */
    protected function resolvePermissions(array $permissions): Collection
    {
        return collect($permissions)
            ->flatten()
            ->reject(fn ($permission) => $permission === null || $permission === '')
            ->map(function (Permission|string|int $permission) {
                if ($permission instanceof Permission) {
                    return $permission->getKey();
                }

                $model = is_numeric($permission)
                    ? Permission::find($permission)
                    : Permission::where('name', $permission)->first();

                if ($model === null) {
                    throw new InvalidArgumentException("Permission [{$permission}] does not exist.");
                }

                return $model->getKey();
            })
            ->unique()
            ->values();
    }
}
