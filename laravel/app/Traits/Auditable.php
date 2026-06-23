<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Facades\Auth;

/**
 * Records created / updated / deleted events for the model into the
 * audit_logs table for compliance tracking.
 */
trait Auditable
{
    /**
     * Boot the trait and hook into the model's lifecycle events.
     */
    public static function bootAuditable(): void
    {
        static::created(function ($model) {
            $model->recordAudit('created', null, $model->auditableValues($model->getAttributes()));
        });

        static::updated(function ($model) {
            $changed = $model->getChanges();
            $original = array_intersect_key($model->getRawOriginal(), $changed);

            $model->recordAudit(
                'updated',
                $model->auditableValues($original),
                $model->auditableValues($changed),
            );
        });

        static::deleted(function ($model) {
            $model->recordAudit('deleted', $model->auditableValues($model->getAttributes()), null);
        });
    }

    /**
     * All audit log entries for this model instance.
     */
    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    /**
     * Return the audit history for this model, newest first.
     *
     * @return Collection<int, AuditLog>
     */
    public function getAuditHistory(): Collection
    {
        return $this->auditLogs()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();
    }

    /**
     * Attribute names excluded from audit values (secrets and noise).
     *
     * Override by declaring a `protected array $auditExclude` on the model.
     *
     * @return list<string>
     */
    protected function auditExcluded(): array
    {
        $custom = property_exists($this, 'auditExclude') ? $this->auditExclude : [];

        return array_values(array_unique(array_merge(
            ['password', 'remember_token'],
            method_exists($this, 'getHidden') ? $this->getHidden() : [],
            $custom,
        )));
    }

    /**
     * Strip excluded fields from a set of attribute values.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    protected function auditableValues(array $values): array
    {
        return array_diff_key($values, array_flip($this->auditExcluded()));
    }

    /**
     * Persist a single audit log entry for this model.
     *
     * @param  array<string, mixed>|null  $oldValues
     * @param  array<string, mixed>|null  $newValues
     */
    protected function recordAudit(string $event, ?array $oldValues, ?array $newValues): void
    {
        $this->auditLogs()->create([
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => request()->ip(),
            'user_agent' => request()->userAgent(),
        ]);
    }
}
