<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Events\Created;
use Illuminate\Database\Eloquent\Events\Deleted;
use Illuminate\Database\Eloquent\Events\Updated;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

trait Auditable
{
    /**
     * Fields that should never be logged.
     *
     * @var array<string>
     */
    protected array $auditExclude = ['password', 'remember_token'];

    /**
     * Boot the trait.
     */
    protected static function bootAuditable(): void
    {
        static::created(function ($model) {
            self::logAudit('created', $model, [
                'new_values' => self::getAuditValues($model->getAttributes(), $model->getOriginal()),
            ]);
        });

        static::updated(function ($model) {
            $dirty = $model->getDirty();
            if (empty($dirty)) {
                return;
            }
            self::logAudit('updated', $model, [
                'old_values' => self::getAuditValues($model->getOriginal(), $dirty),
                'new_values' => self::getAuditValues($dirty, $model->getAttributes()),
            ]);
        });

        static::deleted(function ($model) {
            self::logAudit('deleted', $model, [
                'old_values' => self::getAuditValues([], $model->getAttributes()),
            ]);
        });
    }

    /**
     * Get values to log, excluding sensitive fields.
     *
     * @param  array<string, mixed>  $values
     * @param  array<string, mixed>  $reference
     * @return array<string, mixed>
     */
    protected static function getAuditValues(array $values, array $reference): array
    {
        $exclude = (new static())->auditExclude;

        return array_diff_key($values, array_flip($exclude));
    }

    /**
     * Log an audit entry.
     *
     * @param  string  $event
     * @param  mixed  $model
     * @param  array<string, mixed>  $payload
     */
    protected static function logAudit(string $event, $model, array $payload): void
    {
        $user = Auth::user();

        AuditLog::create([
            'auditable_type' => get_class($model),
            'auditable_id' => $model->getKey(),
            'event' => $event,
            'old_values' => $payload['old_values'] ?? null,
            'new_values' => $payload['new_values'] ?? null,
            'user_id' => $user?->getAuthIdentifier(),
            'ip_address' => Request::ip(),
            'user_agent' => Request::userAgent(),
        ]);
    }

    /**
     * Get the audit history for this model.
     *
     * @return \Illuminate\Database\Eloquent\Collection<int, AuditLog>
     */
    public function getAuditHistory()
    {
        return AuditLog::where('auditable_type', get_class($this))
            ->where('auditable_id', $this->getKey())
            ->orderBy('created_at', 'desc')
            ->get();
    }

    /**
     * Fields to exclude from audit logs.
     *
     * @return array<string>
     */
    public function getAuditExclude(): array
    {
        return $this->auditExclude;
    }
}