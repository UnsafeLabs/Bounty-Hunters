<?php

namespace App\Traits;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Collection;

trait HasRoles
{
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(
            Role::class,
            'model_has_roles',
            'model_id',
            'role_id'
        );
    }

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(
            Permission::class,
            'model_has_permissions',
            'model_id',
            'permission_id'
        );
    }

    public function assignRole(string $roleName): self
    {
        $role = Role::firstOrCreate(['name' => $roleName, 'guard_name' => 'web']);
        $this->roles()->syncWithoutDetaching([$role->id]);
        return $this;
    }

    public function removeRole(string $roleName): self
    {
        $role = Role::where('name', $roleName)->first();
        if ($role) {
            $this->roles()->detach($role->id);
        }
        return $this;
    }

    public function hasRole(string $roleName): bool
    {
        return $this->roles()->where('name', $roleName)->exists();
    }

    public function hasPermission(string $permissionName): bool
    {
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

        $rolePermissions = $this->roles()
            ->with('permissions')
            ->get()
            ->flatMap(fn (Role $role) => $role->permissions);

        return $directPermissions->merge($rolePermissions)->unique('id');
    }

    public function givePermissionTo(string $permissionName): self
    {
        $permission = Permission::firstOrCreate(['name' => $permissionName, 'guard_name' => 'web']);
        $this->permissions()->syncWithoutDetaching([$permission->id]);
        return $this;
    }

    public function revokePermissionTo(string $permissionName): self
    {
        $permission = Permission::where('name', $permissionName)->first();
        if ($permission) {
            $this->permissions()->detach($permission->id);
        }
        return $this;
    }
}