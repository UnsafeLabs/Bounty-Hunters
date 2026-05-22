<?php

namespace App\Traits;

use App\Models\Role;
use App\Models\Permission;
use Illuminate\Support\Facades\DB;

trait HasRoles
{
    /**
     * Assign a role to this model.
     *
     * @param string|Role $role
     * @return $this
     */
    public function assignRole(string|Role $role): static
    {
        $roleModel = $role instanceof Role ? $role : Role::where('name', $role)->firstOrFail();

        DB::table('model_has_roles')->updateOrInsert([
            'model_type' => static::class,
            'model_id' => $this->getKey(),
            'role_id' => $roleModel->getKey(),
        ], [
            'model_type' => static::class,
            'model_id' => $this->getKey(),
            'role_id' => $roleModel->getKey(),
        ]);

        return $this;
    }

    /**
     * Remove a role from this model.
     *
     * @param string|Role $role
     * @return $this
     */
    public function removeRole(string|Role $role): static
    {
        $roleModel = $role instanceof Role ? $role : Role::where('name', $role)->firstOrFail();

        DB::table('model_has_roles')
            ->where('model_type', static::class)
            ->where('model_id', $this->getKey())
            ->where('role_id', $roleModel->getKey())
            ->delete();

        return $this;
    }

    /**
     * Check if the model has a specific role.
     *
     * @param string|array $role
     * @return bool
     */
    public function hasRole(string|array $role): bool
    {
        if (is_array($role)) {
            foreach ($role as $r) {
                if ($this->hasRole($r)) {
                    return true;
                }
            }
            return false;
        }

        return DB::table('model_has_roles')
            ->where('model_type', static::class)
            ->where('model_id', $this->getKey())
            ->where('role_id', function ($query) use ($role) {
                $query->select('id')
                    ->from('roles')
                    ->where('name', $role)
                    ->limit(1);
            })
            ->exists();
    }

    /**
     * Check if the model has a specific permission (via roles or direct).
     *
     * @param string $permission
     * @return bool
     */
    public function hasPermission(string $permission): bool
    {
        return DB::table('model_has_permissions')
            ->where('model_type', static::class)
            ->where('model_id', $this->getKey())
            ->where('permission_id', function ($query) use ($permission) {
                $query->select('id')
                    ->from('permissions')
                    ->where('name', $permission)
                    ->limit(1);
            })
            ->exists()
            || $this->hasPermissionViaRole($permission);
    }

    /**
     * Check if the model has permission via one of their roles.
     *
     * @param string $permission
     * @return bool
     */
    protected function hasPermissionViaRole(string $permission): bool
    {
        $roleIds = DB::table('model_has_roles')
            ->where('model_type', static::class)
            ->where('model_id', $this->getKey())
            ->pluck('role_id');

        if ($roleIds->isEmpty()) {
            return false;
        }

        return DB::table('role_has_permissions')
            ->whereIn('role_id', $roleIds)
            ->where('permission_id', function ($query) use ($permission) {
                $query->select('id')
                    ->from('permissions')
                    ->where('name', $permission)
                    ->limit(1);
            })
            ->exists();
    }

    /**
     * Get all permissions for this model (via roles and direct).
     *
     * @return \Illuminate\Support\Collection
     */
    public function getAllPermissions(): \Illuminate\Support\Collection
    {
        $roleIds = DB::table('model_has_roles')
            ->where('model_type', static::class)
            ->where('model_id', $this->getKey())
            ->pluck('role_id');

        $directPerms = DB::table('model_has_permissions')
            ->where('model_type', static::class)
            ->where('model_id', $this->getKey())
            ->pluck('permission_id');

        $rolePerms = DB::table('role_has_permissions')
            ->whereIn('role_id', $roleIds)
            ->pluck('permission_id');

        $permIds = $directPerms->merge($rolePerms)->unique();

        return Permission::whereIn('id', $permIds)->get();
    }
}