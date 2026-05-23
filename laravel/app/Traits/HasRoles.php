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
        return $this->morphToMany(Role::class, 'model', 'model_has_roles');
    }

    public function permissions(): MorphToMany
    {
        return $this->morphToMany(
            Permission::class,
            'model',
            'model_has_permissions'
        );
    }

    public function assignRole(Role|string $role): static
    {
        $roleModel = $role instanceof Role
            ? $role
            : Role::query()->firstOrCreate(['name' => $role], ['guard_name' => 'web']);

        $this->roles()->syncWithoutDetaching([$roleModel->getKey()]);

        return $this;
    }

    public function removeRole(Role|string $role): static
    {
        $roleModel = $role instanceof Role
            ? $role
            : Role::query()->where('name', $role)->first();

        if ($roleModel !== null) {
            $this->roles()->detach($roleModel->getKey());
        }

        return $this;
    }

    public function hasRole(Role|string $role): bool
    {
        $roleName = $role instanceof Role ? $role->name : $role;

        return $this->roles()->where('name', $roleName)->exists();
    }

    public function hasPermission(Permission|string $permission): bool
    {
        $permissionName = $permission instanceof Permission
            ? $permission->name
            : $permission;

        return $this->getAllPermissions()
            ->contains(fn (Permission $item) => $item->name === $permissionName);
    }

    public function getAllPermissions(): Collection
    {
        $direct = $this->permissions()->get();
        $viaRoles = Permission::query()
            ->whereHas('roles', fn ($query) => $query->whereIn(
                'roles.id',
                $this->roles()->pluck('roles.id')
            ))
            ->get();

        return $direct->merge($viaRoles)->unique('id')->values();
    }
}
