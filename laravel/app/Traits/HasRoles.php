<?php

namespace App\Traits;

use App\Models\Role;
use App\Models\Permission;

trait HasRoles
{
    public function roles()
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles');
    }

    public function permissions()
    {
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions');
    }

    public function hasRole(string $role): bool
    {
        return $this->roles()->where('name', $role)->exists();
    }

    public function hasPermission(string $permission): bool
    {
        return $this->permissions()->where('name', $permission)->exists()
            || $this->roles()->whereHas('permissions', fn($q) => $q->where('name', $permission))->exists();
    }

    public function assignRole(string $role): void
    {
        $roleModel = Role::firstOrCreate(['name' => $role]);
        $this->roles()->syncWithoutDetaching([$roleModel->id]);
    }

    public function givePermission(string $permission): void
    {
        $perm = Permission::firstOrCreate(['name' => $permission]);
        $this->permissions()->syncWithoutDetaching([$perm->id]);
    }
}