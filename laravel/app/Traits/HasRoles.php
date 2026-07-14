<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;

trait HasRoles
{
    public function roles()
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles', 'model_id', 'role_id');
    }

    public function permissions()
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions', 'model_id', 'permission_id');
    }

    public function assignRole(...$roles): static
    {
        $roles = collect($roles)->flatten()->map(function ($role) {
            if (is_string($role)) {
                return Role::firstOrCreate(['name' => $role]);
            }
            return $role;
        });

        $this->roles()->syncWithoutDetaching($roles->pluck('id')->toArray());

        return $this;
    }

    public function removeRole(...$roles): static
    {
        $roles = collect($roles)->flatten()->map(function ($role) {
            if (is_string($role)) {
                return Role::where('name', $role)->first();
            }
            return $role;
        })->filter();

        $this->roles()->detach($roles->pluck('id')->toArray());

        return $this;
    }

    public function hasRole(string $role): bool
    {
        return $this->roles()->where('name', $role)->exists();
    }

    public function hasPermission(string $permission): bool
    {
        $permissionIds = $this->permissions()->pluck('permissions.id');

        foreach ($this->roles()->with('permissions')->get() as $role) {
            $permissionIds = $permissionIds->merge($role->permissions->pluck('id'));
        }

        return Permission::where('name', $permission)
            ->whereIn('id', $permissionIds->unique())
            ->exists();
    }

    public function getAllPermissions(): array
    {
        $directPermissions = $this->permissions()->pluck('name')->toArray();

        $rolePermissions = [];
        foreach ($this->roles()->with('permissions')->get() as $role) {
            foreach ($role->permissions as $perm) {
                $rolePermissions[] = $perm->name;
            }
        }

        return array_values(array_unique(array_merge($directPermissions, $rolePermissions)));
    }
}
