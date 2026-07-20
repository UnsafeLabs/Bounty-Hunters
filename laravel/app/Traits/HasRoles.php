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
        return $this->morphToMany(Permission::class, 'model', 'model_has_permissions');
    }

    public function assignRole(string|Role $role): self
    {
        $role = $role instanceof Role ? $role : Role::query()->where('name', $role)->firstOrFail();
        $this->roles()->syncWithoutDetaching([$role->id]);

        return $this;
    }

    public function removeRole(string|Role $role): self
    {
        $role = $role instanceof Role ? $role : Role::query()->where('name', $role)->firstOrFail();
        $this->roles()->detach($role->id);

        return $this;
    }

    public function hasRole(string $role): bool
    {
        return $this->roles()->where('name', $role)->exists();
    }

    public function hasPermission(string $permission): bool
    {
        if ($this->permissions()->where('name', $permission)->exists()) {
            return true;
        }

        return $this->roles()
            ->whereHas('permissions', fn ($q) => $q->where('name', $permission))
            ->exists();
    }

    public function getAllPermissions(): Collection
    {
        $direct = $this->permissions()->get();
        $viaRoles = Permission::query()
            ->whereHas('roles', function ($q) {
                $q->whereIn('roles.id', $this->roles()->pluck('roles.id'));
            })
            ->get();

        return $direct->merge($viaRoles)->unique('id')->values();
    }
}
