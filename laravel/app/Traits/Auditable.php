<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Arr;

trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(function (Model $model): void {
            $model->writeAuditLog('created', [], $model->auditableValues($model->getAttributes()));
        });

        static::updated(function (Model $model): void {
            $changedKeys = array_keys($model->getChanges());
            $oldValues = $model->auditableValues(Arr::only($model->getOriginal(), $changedKeys));
            $newValues = $model->auditableValues(Arr::only($model->getAttributes(), $changedKeys));

            if ($oldValues !== [] || $newValues !== []) {
                $model->writeAuditLog('updated', $oldValues, $newValues);
            }
        });

        static::deleted(function (Model $model): void {
            $model->writeAuditLog('deleted', $model->auditableValues($model->getOriginal()), []);
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
     * @param array<string, mixed> $oldValues
     * @param array<string, mixed> $newValues
     */
    protected function writeAuditLog(string $event, array $oldValues, array $newValues): void
    {
        AuditLog::query()->create([
            'auditable_type' => $this->getMorphClass(),
            'auditable_id' => $this->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => auth()->id(),
            'ip_address' => request()?->ip(),
            'user_agent' => request()?->userAgent(),
        ]);
    }

    /**
     * @param array<string, mixed> $values
     * @return array<string, mixed>
     */
    protected function auditableValues(array $values): array
    {
        return Arr::except($values, $this->auditExcludedFields());
    }

    /**
     * @return array<int, string>
     */
    protected function auditExcludedFields(): array
    {
        return array_values(array_unique(array_merge([
            'password',
            'remember_token',
        ], property_exists($this, 'hidden') ? $this->hidden : [])));
    }
}
