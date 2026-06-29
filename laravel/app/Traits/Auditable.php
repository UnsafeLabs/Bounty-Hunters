<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Arr;

trait Auditable
{
    /**
     * @return MorphMany<AuditLog>
     */
    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    /**
     * @return MorphMany<AuditLog>
     */
    public function getAuditHistory(): MorphMany
    {
        return $this->auditLogs()->latest();
    }

    protected static function bootAuditable(): void
    {
        static::created(function (Model $model): void {
            $model->writeAuditLog('created', [], $model->auditAttributes($model->getAttributes()));
        });

        static::updated(function (Model $model): void {
            $changes = Arr::except($model->getChanges(), ['created_at', 'updated_at']);

            if ($changes === []) {
                return;
            }

            $oldValues = [];

            foreach (array_keys($changes) as $attribute) {
                $oldValues[$attribute] = $model->getOriginal($attribute);
            }

            $model->writeAuditLog(
                'updated',
                $model->auditAttributes($oldValues),
                $model->auditAttributes($changes)
            );
        });

        static::deleted(function (Model $model): void {
            $model->writeAuditLog('deleted', $model->auditAttributes($model->getOriginal()), []);
        });
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
     * @param array<string, mixed> $attributes
     *
     * @return array<string, mixed>
     */
    protected function auditAttributes(array $attributes): array
    {
        return Arr::except($attributes, $this->auditHiddenAttributes());
    }

    /**
     * @return array<int, string>
     */
    protected function auditHiddenAttributes(): array
    {
        return array_values(array_unique(array_merge(
            method_exists($this, 'getHidden') ? $this->getHidden() : [],
            ['password', 'remember_token']
        )));
    }
}
