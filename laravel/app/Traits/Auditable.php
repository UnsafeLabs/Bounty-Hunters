<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

trait Auditable
{
    /**
     * Attributes that must never be persisted to audit payloads.
     *
     * @var array<int, string>
     */
    protected static array $auditSensitiveFields = [
        'password',
        'remember_token',
    ];

    public static function bootAuditable(): void
    {
        static::created(function ($model): void {
            $model->recordAudit('created', [], $model->auditSnapshot($model->getAttributes()));
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

            $model->recordAudit(
                'updated',
                $model->auditSnapshot($oldValues),
                $model->auditSnapshot($changes),
            );
        });

        static::deleted(function ($model): void {
            $model->recordAudit('deleted', $model->auditSnapshot($model->getOriginal()), []);
        });
    }

    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    public function getAuditHistory()
    {
        return $this->auditLogs()
            ->latest()
            ->get();
    }

    /**
     * @param array<string, mixed> $oldValues
     * @param array<string, mixed> $newValues
     */
    protected function recordAudit(string $event, array $oldValues, array $newValues): void
    {
        AuditLog::query()->create([
            'auditable_type' => static::class,
            'auditable_id' => (string) $this->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => Request::ip(),
            'user_agent' => Request::userAgent(),
        ]);
    }

    /**
     * @param array<string, mixed> $attributes
     * @return array<string, mixed>
     */
    protected function auditSnapshot(array $attributes): array
    {
        return collect($attributes)
            ->except(static::$auditSensitiveFields)
            ->all();
    }
}
