<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

trait Auditable
{
    protected static function bootAuditable(): void
    {
        static::created(function ($model) {
            static::createAuditLog($model, 'created', [], $model->getAttributes());
        });

        static::updated(function ($model) {
            static::createAuditLog($model, 'updated', $model->getOriginal(), $model->getChanges());
        });

        static::deleted(function ($model) {
            static::createAuditLog($model, 'deleted', $model->getOriginal(), []);
        });
    }

    protected static function createAuditLog($model, string $event, array $oldValues, array $newValues): void
    {
        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id' => $model->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => Request::ip(),
            'user_agent' => Request::userAgent(),
        ]);
    }

    public function getAuditHistory(int $limit = 50)
    {
        return AuditLog::where('auditable_type', get_class($this))
            ->where('auditable_id', $this->getKey())
            ->orderBy('created_at', 'desc')
            ->limit($limit)
            ->get();
    }

    public function auditLogs()
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }
}
