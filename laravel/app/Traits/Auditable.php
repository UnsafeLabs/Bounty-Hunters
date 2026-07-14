<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

trait Auditable
{
    protected static $sensitiveFields = ['password', 'password_confirmation', 'remember_token', 'api_key', 'token', 'secret'];

    protected static function bootAuditable(): void
    {
        static::created(function ($model) {
            $model->logAudit('created', null, $model->getAuditAttributes());
        });

        static::updated(function ($model) {
            $original = collect($model->getOriginal())
                ->only(array_keys($model->getAuditAttributes()))
                ->toArray();
            $model->logAudit('updated', $original, $model->getAuditAttributes());
        });

        static::deleted(function ($model) {
            $model->logAudit('deleted', $model->getAuditAttributes(), null);
        });
    }

    public function getAuditAttributes(): array
    {
        $attributes = $this->getAttributes();

        foreach (static::$sensitiveFields as $field) {
            if (array_key_exists($field, $attributes)) {
                $attributes[$field] = '[REDACTED]';
            }
        }

        return $attributes;
    }

    public function logAudit(string $event, ?array $oldValues, ?array $newValues): AuditLog
    {
        return AuditLog::create([
            'auditable_type' => static::class,
            'auditable_id' => $this->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => Request::ip(),
            'user_agent' => Request::userAgent(),
        ]);
    }

    public function getAuditHistory()
    {
        return AuditLog::where('auditable_type', static::class)
            ->where('auditable_id', $this->getKey())
            ->orderBy('created_at', 'desc')
            ->get();
    }

    public function auditLogs()
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }
}
