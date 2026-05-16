<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['name', 'guard_name'])]
class Role extends Model
{
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions')
            ->withTimestamps();
    }

    public function givePermissionTo(Permission|string $permission): static
    {
        $permission = $permission instanceof Permission
            ? $permission
            : Permission::query()->firstOrCreate([
                'name' => $permission,
                'guard_name' => $this->guard_name,
            ]);

        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);

        return $this;
    }
}
