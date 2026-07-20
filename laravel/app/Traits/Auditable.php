<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

/**
 * Track created/updated/deleted events for compliance audit trails (#786).
 */
trait Auditable
{
    /** @var list<string> */
    protected static array $auditExclude = [
        'password',
        'remember_token',
        'two_factor_secret',
        'two_factor_recovery_codes',
    ];

    public static function bootAuditable(): void
    {
        static::created(function (Model $model) {
            static::writeAudit($model, 'created', null, static::auditAttributes($model));
        });

        static::updated(function (Model $model) {
            $old = [];
            $new = [];
            foreach ($model->getChanges() as $key => $value) {
                if (in_array($key, static::excludedAuditFields($model), true)) {
                    continue;
                }
                if ($key === 'updated_at') {
                    continue;
                }
                $old[$key] = $model->getOriginal($key);
                $new[$key] = $value;
            }
            if ($old === [] && $new === []) {
                return;
            }
            static::writeAudit($model, 'updated', $old, $new);
        });

        static::deleted(function (Model $model) {
            static::writeAudit($model, 'deleted', static::auditAttributes($model), null);
        });
    }

    /**
     * @return list<string>
     */
    protected static function excludedAuditFields(Model $model): array
    {
        $extra = property_exists($model, 'auditExclude')
            ? (array) $model->auditExclude
            : [];

        return array_values(array_unique(array_merge(static::$auditExclude, $extra)));
    }

    /**
     * @return array<string, mixed>
     */
    protected static function auditAttributes(Model $model): array
    {
        $attrs = $model->getAttributes();
        foreach (static::excludedAuditFields($model) as $field) {
            unset($attrs[$field]);
        }

        return $attrs;
    }

    protected static function writeAudit(
        Model $model,
        string $event,
        ?array $oldValues,
        ?array $newValues,
    ): void {
        AuditLog::query()->create([
            'auditable_type' => $model->getMorphClass(),
            'auditable_id' => $model->getKey(),
            'event' => $event,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'user_id' => Auth::id(),
            'ip_address' => Request::ip(),
            'user_agent' => substr((string) Request::userAgent(), 0, 512) ?: null,
        ]);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\MorphMany
     */
    public function auditLogs()
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    /**
     * Audit history newest first.
     *
     * @return \Illuminate\Database\Eloquent\Collection<int, AuditLog>
     */
    public function getAuditHistory()
    {
        return $this->auditLogs()
            ->orderByDesc('id')
            ->get();
    }
}
