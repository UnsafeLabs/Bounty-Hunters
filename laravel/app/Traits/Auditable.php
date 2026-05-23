<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

trait Auditable
{
    protected static function bootAuditable()
    {
        static::created(function ($model) {
            static::logAudit($model, 'created', [], $model->toArray());
        });

        static::updated(function ($model) {
            $old = [];
            foreach ($model->getChanges() as $key => $value) {
                $old[$key] = $model->getOriginal($key);
            }
            static::logAudit($model, 'updated', $old, $model->getChanges());
        });

        static::deleted(function ($model) {
            static::logAudit($model, 'deleted', $model->toArray(), []);
        });
    }

    protected static function logAudit($model, string $event, array $old, array $new): void
    {
        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id' => $model->getKey(),
            'event' => $event,
            'old_values' => $old,
            'new_values' => $new,
            'user_id' => Auth::id(),
            'ip_address' => Request::ip(),
            'user_agent' => Request::userAgent(),
        ]);
    }
}