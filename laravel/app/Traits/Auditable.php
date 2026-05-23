<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Relations\MorphMany;

trait Auditable
{
    protected static array $auditHidden = ['password', 'remember_token'];

    public static function bootAuditable(): void
    {
        static::created(fn ($model) => $model->writeAuditLog('created'));
        static::updated(fn ($model) => $model->writeAuditLog('updated'));
        static::deleted(fn ($model) => $model->writeAuditLog('deleted'));
    }

    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    public function getAuditHistory()
    {
        return $this->auditLogs()->latest()->get();
    }

    protected function writeAuditLog(string $event): void
    {
        $oldValues = [];
        $newValues = [];

        if ($event === 'created') {
            $newValues = $this->auditValues($this->getAttributes());
        } elseif ($event === 'updated') {
            $dirty = array_keys($this->getChanges());
            $oldValues = $this->auditValues($this->getOriginal(), $dirty);
            $newValues = $this->auditValues($this->getAttributes(), $dirty);
        } elseif ($event === 'deleted') {
            $oldValues = $this->auditValues($this->getOriginal());
        }

        $this->auditLogs()->create([
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => auth()->id(),
            'ip_address' => request()?->ip(),
            'user_agent' => request()?->userAgent(),
        ]);
    }

    protected function auditValues(array $values, ?array $only = null): array
    {
        if ($only !== null) {
            $values = array_intersect_key($values, array_flip($only));
        }

        return collect($values)
            ->except(static::$auditHidden)
            ->all();
    }
}
