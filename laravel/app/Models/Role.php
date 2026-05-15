<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['name', 'guard_name'])]
class Role extends Model
{
    /**
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permission = $permission instanceof Permission
            ? $permission
            : Permission::query()->where('name', $permission)->firstOrFail();

        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);

        return $this;
    }

    public function revokePermissionTo(Permission|string $permission): static
    {
        $permission = $permission instanceof Permission
            ? $permission
            : Permission::query()->where('name', $permission)->firstOrFail();

        $this->permissions()->detach($permission->getKey());

        return $this;
    }
}
