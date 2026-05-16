<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Relations\MorphMany;

trait Auditable
{
    /**
     * Register model event listeners for audit logging.
     */
    protected static function bootAuditable(): void
    {
        static::created(function ($model): void {
            $model->recordAudit('created', [], $model->auditValues($model->getAttributes()));
        });

        static::updated(function ($model): void {
            $changed = array_keys($model->getChanges());

            $model->recordAudit(
                'updated',
                $model->auditOriginalValues($changed),
                $model->auditValues($model->only($changed)),
            );
        });

        static::deleted(function ($model): void {
            $model->recordAudit('deleted', $model->auditValues($model->getOriginal()), []);
        });
    }

    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    public function getAuditHistory()
    {
        return $this->auditLogs()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();
    }

    /**
     * @param  array<int, string>  $keys
     * @return array<string, mixed>
     */
    protected function auditOriginalValues(array $keys): array
    {
        $values = [];

        foreach ($keys as $key) {
            $values[$key] = $this->getOriginal($key);
        }

        return $this->auditValues($values);
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    protected function auditValues(array $values): array
    {
        return collect($values)
            ->except($this->auditHiddenAttributes())
            ->all();
    }

    /**
     * @return array<int, string>
     */
    protected function auditHiddenAttributes(): array
    {
        return array_values(array_unique(array_merge($this->getHidden(), [
            'password',
            'remember_token',
        ])));
    }

    /**
     * @param  array<string, mixed>  $oldValues
     * @param  array<string, mixed>  $newValues
     */
    protected function recordAudit(string $event, array $oldValues, array $newValues): void
    {
        AuditLog::create([
            'auditable_type' => $this->getMorphClass(),
            'auditable_id' => $this->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => auth()->id(),
            'ip_address' => request()->ip(),
            'user_agent' => request()->userAgent(),
        ]);
    }
}
