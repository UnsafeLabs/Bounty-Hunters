<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Arr;

trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(function ($model): void {
            $model->writeAuditLog('created', null, $model->auditValuesFromAttributes($model->getAttributes()));
        });

        static::updated(function ($model): void {
            $newValues = $model->auditValuesFromAttributes($model->getChanges());
            $oldValues = Arr::only(
                $model->auditValuesFromAttributes($model->getOriginal()),
                array_keys($newValues)
            );

            $model->writeAuditLog(
                'updated',
                $oldValues,
                $newValues
            );
        });

        static::deleted(function ($model): void {
            $model->writeAuditLog('deleted', $model->auditValuesFromAttributes($model->getOriginal()), null);
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
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    protected function auditValuesFromAttributes(array $attributes): array
    {
        return collect($attributes)
            ->except($this->auditHiddenFields())
            ->all();
    }

    /**
     * @return array<int, string>
     */
    protected function auditHiddenFields(): array
    {
        return array_values(array_unique(array_merge(
            property_exists($this, 'hidden') ? $this->hidden : [],
            ['password', 'remember_token']
        )));
    }

    /**
     * @param  array<string, mixed>|null  $oldValues
     * @param  array<string, mixed>|null  $newValues
     */
    protected function writeAuditLog(string $event, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
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
}
