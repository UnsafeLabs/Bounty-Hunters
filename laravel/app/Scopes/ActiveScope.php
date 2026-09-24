<?php

namespace App\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Restricts every query on the model to rows where `active = 1`.
 *
 * Apply it to a model with the `ScopedBy` attribute, a `booted()` call to
 * `addGlobalScope()`, or by resolving it directly. Models can opt out per
 * query with `withoutGlobalScope(ActiveScope::class)`.
 */
class ActiveScope implements Scope
{
    /**
     * Apply the scope to a given Eloquent query builder.
     */
    public function apply(Builder $builder, Model $model): void
    {
        $builder->where($model->qualifyColumn('active'), true);
    }
}
