<?php
namespace App\RBAC;

/**
 * Fix: Implement lightweight role-based access control (#788)
 */
class RoleBasedAccessControl
{
    private array $roles = [];
    private array $userRoles = [];

    public function addRole(string $role, array $permissions = []): self
    {
        $this->roles[$role] = $permissions;
        return $this;
    }

    public function assignRole(int $userId, string $role): self
    {
        if (!isset($this->userRoles[$userId])) {
            $this->userRoles[$userId] = [];
        }
        $this->userRoles[$userId][$role] = true;
        return $this;
    }

    public function revokeRole(int $userId, string $role): self
    {
        unset($this->userRoles[$userId][$role]);
        return $this;
    }

    public function hasRole(int $userId, string $role): bool
    {
        return isset($this->userRoles[$userId][$role]);
    }

    public function hasPermission(int $userId, string $permission): bool
    {
        $roles = $this->userRoles[$userId] ?? [];
        foreach (array_keys($roles) as $role) {
            if (in_array($permission, $this->roles[$role] ?? [])) {
                return true;
            }
        }
        return false;
    }

    public function getUserRoles(int $userId): array
    {
        return array_keys($this->userRoles[$userId] ?? []);
    }

    public function getRolePermissions(string $role): array
    {
        return $this->roles[$role] ?? [];
    }

    public function addPermissionToRole(string $role, string $permission): self
    {
        if (isset($this->roles[$role])) {
            $this->roles[$role][] = $permission;
        }
        return $this;
    }
}
