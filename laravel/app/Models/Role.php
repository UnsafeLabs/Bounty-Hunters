<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Role extends Model
{
    protected $fillable = ['name', 'guard_name'];

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }

    /**
     * Give this role a permission (by name or model).
     */
    public function givePermissionTo(string|Permission $permission): static
    {
        $permission = $permission instanceof Permission
            ? $permission
            : Permission::where('name', $permission)->firstOrFail();

        $this->permissions()->syncWithoutDetaching([$permission->getKey()]);
        $this->unsetRelation('permissions');

        return $this;
    }
}
