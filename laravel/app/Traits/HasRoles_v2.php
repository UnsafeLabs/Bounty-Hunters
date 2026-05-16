<?php
namespace App\Traits;
use App\Models\Role;
use Illuminate\Support\Facades\Cache;
trait HasRoles {
    public function roles() {
        return $this->belongsToMany(Role::class, 'model_has_roles', 'model_id', 'role_id');
    }
    public function assignRole(string $roleName) {
        $role = Role::findByName($roleName);
        if ($role && !$this->roles->contains($role->id)) {
            $this->roles()->attach($role);
            Cache::forget("user:{$this->id}:permissions");
        }
    }
    public function removeRole(string $roleName) {
        $role = Role::findByName($roleName);
        if ($role) {
            $this->roles()->detach($role);
            Cache::forget("user:{$this->id}:permissions");
        }
    }
    public function hasRole(string $roleName): bool {
        return $this->roles->contains('name', $roleName);
    }
    public function hasPermission(string $perm): bool {
        return collect($this->getAllPermissions())->contains('name', $perm);
    }
    public function getAllPermissions(): array {
        return Cache::remember("user:{$this->id}:permissions", 300, function () {
            return $this->roles()->with('permissions')->get()
                ->pluck('permissions')->flatten()->unique('id')->values()->toArray();
        });
    }
}