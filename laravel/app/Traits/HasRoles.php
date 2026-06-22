<?php

namespace App\Traits;

use App\Models\Role;
use App\Models\Permission;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

trait HasRoles
{
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, "model_has_roles");
    }

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, "model_has_permissions");
    }

    public function assignRole(string $roleName): void
    {
        $role = Role::where("name", $roleName)->first();
        if ($role && !$this->roles()->where("role_id", $role->id)->exists()) {
            $this->roles()->attach($role);
        }
    }

    public function removeRole(string $roleName): void
    {
        $role = Role::where("name", $roleName)->first();
        if ($role) {
            $this->roles()->detach($role);
        }
    }

    public function hasRole(string $roleName): bool
    {
        return $this->roles()->where("name", $roleName)->exists();
    }

    public function hasPermission(string $permissionName): bool
    {
        // Check direct permissions
        if ($this->permissions()->where("name", $permissionName)->exists()) {
            return true;
        }
        // Check permissions through roles
        foreach ($this->roles as $role) {
            if ($role->hasPermission($permissionName)) {
                return true;
            }
        }
        return false;
    }

    public function getAllPermissions(): array
    {
        $permissions = [];
        // From roles
        foreach ($this->roles as $role) {
            foreach ($role->permissions as $perm) {
                $permissions[$perm->name] = $perm;
            }
        }
        // Direct permissions
        foreach ($this->permissions as $perm) {
            $permissions[$perm->name] = $perm;
        }
        return array_values($permissions);
    }
}
