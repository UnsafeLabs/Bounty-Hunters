<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;

trait Auditable
{
    protected static function bootAuditable(): void
    {
        static::created(function (Model $model) {
            static::createAuditLog($model, 'created', [], $model->getAttributes());
        });

        static::updated(function (Model $model) {
            static::createAuditLog($model, 'updated', $model->getOriginal(), $model->getChanges());
        });

        static::deleted(function (Model $model) {
            static::createAuditLog($model, 'deleted', $model->getOriginal(), []);
        });
    }

    protected static function createAuditLog(Model $model, string $event, array $oldValues, array $newValues): void
    {
        $excluded = static::getAuditExcludedFields();

        $oldValues = array_filter(
            $oldValues,
            fn($key) => !in_array($key, $excluded),
            ARRAY_FILTER_USE_KEY,
        );

        $newValues = array_filter(
            $newValues,
            fn($key) => !in_array($key, $excluded),
            ARRAY_FILTER_USE_KEY,
        );

        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id' => $model->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => auth()->id(),
            'ip_address' => request()->ip(),
            'user_agent' => request()->userAgent(),
        ]);
    }

    protected static function getAuditExcludedFields(): array
    {
        return ['password', 'remember_token', 'password_hash'];
    }

    public function getAuditHistory()
    {
        return AuditLog::where('auditable_type', get_class($this))
            ->where('auditable_id', $this->getKey())
            ->orderBy('created_at', 'desc')
            ->get();
    }
}
