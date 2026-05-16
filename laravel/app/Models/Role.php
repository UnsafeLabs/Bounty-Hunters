<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['name', 'guard_name'])]
class Role extends Model
{
    /**
     * @var array<string, string>
     */
    protected $attributes = [
        'guard_name' => 'web',
    ];

    /**
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permission = $this->resolvePermission($permission);

        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);
        $this->unsetRelation('permissions');

        return $this;
    }

    public function revokePermissionTo(Permission|string $permission): static
    {
        $permission = $this->resolvePermission($permission);

        $this->permissions()->detach($permission->getKey());
        $this->unsetRelation('permissions');

        return $this;
    }

    private function resolvePermission(Permission|string $permission): Permission
    {
        if ($permission instanceof Permission) {
            return $permission;
        }

        return Permission::query()
            ->where('name', $permission)
            ->where('guard_name', $this->guard_name)
            ->firstOrFail();
    }
}
