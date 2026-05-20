<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

trait Auditable
{
    protected static function bootAuditable(): void
    {
        static::created(function (Model $model) {
            static::logAudit($model, 'created', $model->toArray());
        });

        static::updated(function (Model $model) {
            $changes = $model->getChanges();
            $original = $model->getOriginal();
            $diff = [];
            foreach ($changes as $key => $value) {
                if (isset($original[$key]) && $original[$key] !== $value) {
                    $diff[$key] = ['from' => $original[$key], 'to' => $value];
                }
            }
            if (!empty($diff)) {
                static::logAudit($model, 'updated', $diff);
            }
        });

        static::deleted(function (Model $model) {
            static::logAudit($model, 'deleted', $model->toArray());
        });

        static::restored(function (Model $model) {
            static::logAudit($model, 'restored', ['id' => $model->id]);
        });
    }

    protected static function logAudit(Model $model, string $event, array $data): void
    {
        $audit = new \App\Models\AuditLog();
        $audit->auditable_type = get_class($model);
        $audit->auditable_id = $model->getKey();
        $audit->event = $event;
        $audit->data = $data;
        $audit->user_id = Auth::id();
        $audit->ip_address = Request::ip();
        $audit->user_agent = Request::userAgent();
        $audit->save();
    }
}
