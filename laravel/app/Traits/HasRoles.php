<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Collection;

trait HasRoles
{
    /**
     * Roles assigned directly to the model.
     *
     * @return BelongsToMany<Role, $this>
     */
    public function roles(): BelongsToMany
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles')
            ->withTimestamps();
    }

    /**
     * Permissions assigned directly to the model.
     *
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions')
            ->withTimestamps();
    }

    public function assignRole(Role|string $role): static
    {
        $roleModel = $this->resolveRole($role);
        $this->roles()->syncWithoutDetaching([$roleModel->id]);

        return $this;
    }

    public function removeRole(Role|string $role): static
    {
        $roleModel = $this->resolveRole($role);
        $this->roles()->detach($roleModel->id);

        return $this;
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permissionModel = $this->resolvePermission($permission);
        $this->permissions()->syncWithoutDetaching([$permissionModel->id]);

        return $this;
    }

    public function revokePermissionTo(Permission|string $permission): static
    {
        $permissionModel = $this->resolvePermission($permission);
        $this->permissions()->detach($permissionModel->id);

        return $this;
    }

    public function hasRole(Role|string $role): bool
    {
        $roleName = $role instanceof Role ? $role->name : $role;

        return $this->roles()
            ->where('name', $roleName)
            ->exists();
    }

    public function hasPermissionTo(Permission|string $permission): bool
    {
        $permissionName = $permission instanceof Permission ? $permission->name : $permission;

        return $this->permissions()
            ->where('name', $permissionName)
            ->exists()
            || $this->roles()
                ->whereHas('permissions', fn ($query) => $query->where('name', $permissionName))
                ->exists();
    }

    /**
     * @return Collection<int, Permission>
     */
    public function getAllPermissions(): Collection
    {
        $directPermissions = $this->permissions()->get();
        $rolePermissions = Permission::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('roles.id', $this->roles()->pluck('roles.id')))
            ->get();

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

        return Role::query()->where('name', $role)->firstOrFail();
    }

    protected function resolvePermission(Permission|string $permission): Permission
    {
        if ($permission instanceof Permission) {
            return $permission;
        }

        return Permission::query()->where('name', $permission)->firstOrFail();
    }
}
