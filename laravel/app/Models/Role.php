<?php

namespace App\Models;

use Database\Factories\RoleFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Support\Collection;
use InvalidArgumentException;

#[Fillable(['name', 'guard_name'])]
class Role extends Model
{
    /** @use HasFactory<RoleFactory> */
    use HasFactory;

    /**
     * The model's default attribute values.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'guard_name' => 'web',
    ];

    /**
     * The permissions that belong to the role.
     *
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }

    /**
     * The users that are assigned the role.
     *
     * @return MorphToMany<User, $this>
     */
    public function users(): MorphToMany
    {
        return $this->morphedByMany(User::class, 'model', 'model_has_roles');
    }

    /**
     * Grant the given permission(s) to the role.
     */
    public function givePermissionTo(Permission|string|int ...$permissions): static
    {
        $ids = $this->resolvePermissions($permissions);

        if ($ids->isNotEmpty()) {
            $this->permissions()->syncWithoutDetaching($ids->all());
            $this->unsetRelation('permissions');
        }

        return $this;
    }

    /**
     * Revoke the given permission from the role.
     */
    public function revokePermissionTo(Permission|string|int $permission): static
    {
        $this->permissions()->detach($this->resolvePermissions([$permission])->all());
        $this->unsetRelation('permissions');

        return $this;
    }

    /**
     * Determine whether the role has the given permission.
     */
    public function hasPermissionTo(Permission|string $permission): bool
    {
        $name = $permission instanceof Permission ? $permission->name : $permission;

        return $this->permissions->contains(fn (Permission $granted) => $granted->name === $name);
    }

    /**
     * Resolve the given permissions to a collection of unique primary keys.
     *
     * @param  array<int, Permission|string|int>  $permissions
     * @return Collection<int, int>
     */
    protected function resolvePermissions(array $permissions): Collection
    {
        return collect($permissions)
            ->flatten()
            ->reject(fn ($permission) => $permission === null || $permission === '')
            ->map(function (Permission|string|int $permission) {
                if ($permission instanceof Permission) {
                    return $permission->getKey();
                }

                $model = is_numeric($permission)
                    ? Permission::find($permission)
                    : Permission::where('name', $permission)->first();

                if ($model === null) {
                    throw new InvalidArgumentException("Permission [{$permission}] does not exist.");
                }

                return $model->getKey();
            })
            ->unique()
            ->values();
    }
}
