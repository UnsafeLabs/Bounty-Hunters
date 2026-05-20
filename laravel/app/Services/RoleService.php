<?php

namespace App\Services;

use App\Models\User;
use App\Models\Role;
use App\Models\Permission;
use Illuminate\Support\Facades\Cache;

class RoleService
{
    public function assignRole(User $user, string $roleName): void
    {
        $role = Role::where('name', $roleName)->first();
        if (!$role) {
            throw new \InvalidArgumentException("Role {$roleName} not found");
        }
        $user->roles()->syncWithoutDetaching([$role->id]);
        Cache::forget("user.{$user->id}.permissions");
    }

    public function removeRole(User $user, string $roleName): void
    {
        $role = Role::where('name', $roleName)->first();
        if ($role) {
            $user->roles()->detach($role->id);
            Cache::forget("user.{$user->id}.permissions");
        }
    }

    public function hasPermission(User $user, string $permission): bool
    {
        return Cache::remember("user.{$user->id}.permissions", 3600, function () use ($user) {
            return $user->roles()->with('permissions')->get()
                ->pluck('permissions')
                ->flatten()
                ->pluck('name')
                ->unique()
                ->toArray();
        });
    }

    public function createRole(string $name, array $permissions = []): Role
    {
        $role = Role::create(['name' => $name]);
        if (!empty($permissions)) {
            $permIds = Permission::whereIn('name', $permissions)->pluck('id');
            $role->permissions()->sync($permIds);
        }
        return $role;
    }

    public function createPermission(string $name): Permission
    {
        return Permission::firstOrCreate(['name' => $name]);
    }

    public function syncPermissions(Role $role, array $permissions): void
    {
        $permIds = Permission::whereIn('name', $permissions)->pluck('id');
        $role->permissions()->sync($permIds);
    }
}
