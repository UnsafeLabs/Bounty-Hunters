<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Facades\Auth;

trait Auditable
{
    protected static array $auditHidden = ['password', 'remember_token'];

    public static function bootAuditable(): void
    {
        static::created(function ($model): void {
            $model->writeAuditLog('created', [], $model->auditValues($model->getAttributes()));
        });

        static::updated(function ($model): void {
            $changes = $model->getChanges();
            unset($changes['updated_at']);

            if ($changes === []) {
                return;
            }

            $oldValues = [];
            foreach (array_keys($changes) as $attribute) {
                $oldValues[$attribute] = $model->getOriginal($attribute);
            }

            $model->writeAuditLog(
                'updated',
                $model->auditValues($oldValues),
                $model->auditValues($changes),
            );
        });

        static::deleted(function ($model): void {
            $model->writeAuditLog('deleted', $model->auditValues($model->getOriginal()), []);
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

    protected function writeAuditLog(string $event, array $oldValues, array $newValues): void
    {
        $request = request();

        $this->auditLogs()->create([
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
        ]);
    }

    protected function auditValues(array $values): array
    {
        return collect($values)
            ->except(static::$auditHidden)
            ->all();
    }
}
