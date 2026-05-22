<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;

trait Auditable
{
    /**
     * Fields that should never be persisted in audit payloads.
     *
     * @var array<int, string>
     */
    protected static array $defaultAuditHidden = [
        'password',
        'remember_token',
    ];

    /**
     * Register model event hooks for audit logging.
     */
    protected static function bootAuditable(): void
    {
        static::created(function (Model $model): void {
            $model->writeAuditLog('created', [], $model->auditValues($model->getAttributes()));
        });

        static::updated(function (Model $model): void {
            $changed = $model->auditValues($model->getChanges());

            if ($changed === []) {
                return;
            }

            $oldValues = $model->auditValues(
                Arr::only($model->getOriginal(), array_keys($changed))
            );

            $model->writeAuditLog('updated', $oldValues, $changed);
        });

        static::deleted(function (Model $model): void {
            $model->writeAuditLog('deleted', $model->auditValues($model->getOriginal()), []);
        });
    }

    /**
     * Get all audit log entries for this model in reverse chronological order.
     */
    public function getAuditHistory(): Collection
    {
        return $this->auditLogs()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();
    }

    /**
     * Get the audit logs for this model.
     */
    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    /**
     * Create a persisted audit log entry for this model.
     *
     * @param  array<string, mixed>  $oldValues
     * @param  array<string, mixed>  $newValues
     */
    protected function writeAuditLog(string $event, array $oldValues, array $newValues): void
    {
        $request = app()->bound('request') ? request() : null;

        $this->auditLogs()->create([
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
        ]);
    }

    /**
     * Filter out sensitive and non-business attributes before storing audit data.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    protected function auditValues(array $values): array
    {
        $hidden = array_unique(array_merge(
            static::$defaultAuditHidden,
            method_exists($this, 'getHidden') ? $this->getHidden() : []
        ));

        return Arr::except($values, array_merge($hidden, [
            'created_at',
            'updated_at',
        ]));
    }
}
