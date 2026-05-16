<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;

trait HasRoles
{
    /**
     * @return MorphToMany<Role, $this>
     */
    public function roles(): MorphToMany
    {
        return $this->morphToMany(
            Role::class,
            'model',
            'model_has_roles',
            'model_id',
            'role_id',
        );
    }

    /**
     * @return MorphToMany<Permission, $this>
     */
    public function permissions(): MorphToMany
    {
        return $this->morphToMany(
            Permission::class,
            'model',
            'model_has_permissions',
            'model_id',
            'permission_id',
        );
    }

    public function assignRole(Role|string $role): static
    {
        $role = $this->resolveRole($role);

        $this->roles()->syncWithoutDetaching([$role->getKey()]);
        $this->unsetRelation('roles');

        return $this;
    }

    public function removeRole(Role|string $role): static
    {
        $role = $this->resolveRole($role);

        $this->roles()->detach($role->getKey());
        $this->unsetRelation('roles');

        return $this;
    }

    public function hasRole(Role|string $role): bool
    {
        if ($role instanceof Role) {
            return $this->roles()->whereKey($role->getKey())->exists();
        }

        return $this->roles()->where('name', $role)->exists();
    }

    public function hasPermission(Permission|string $permission): bool
    {
        if ($permission instanceof Permission) {
            $permissionId = $permission->getKey();

            return $this->permissions()->whereKey($permissionId)->exists()
                || $this->roles()
                    ->whereHas('permissions', fn ($query) => $query->whereKey($permissionId))
                    ->exists();
        }

        return $this->permissions()->where('name', $permission)->exists()
            || $this->roles()
                ->whereHas('permissions', fn ($query) => $query->where('name', $permission))
                ->exists();
    }

    /**
     * @return Collection<int, Permission>
     */
    public function getAllPermissions(): Collection
    {
        $directPermissions = $this->permissions()->get();
        $roleIds = $this->roles()->pluck('roles.id');

        if ($roleIds->isEmpty()) {
            return $directPermissions->unique('id')->values();
        }

        $rolePermissions = Permission::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('roles.id', $roleIds))
            ->get();

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

        return Role::query()->where('name', $role)->firstOrFail();
    }
}
