<?php

namespace App\Traits;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Facades\Auth;

trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(function (Model $model): void {
            $model->recordAudit('created', [], $model->auditValues($model->getAttributes()));
        });

        static::updated(function (Model $model): void {
            $changedKeys = array_keys($model->getChanges());

            $model->recordAudit(
                'updated',
                $model->auditValues($model->getOriginal(), $changedKeys),
                $model->auditValues($model->getAttributes(), $changedKeys),
            );
        });

        static::deleted(function (Model $model): void {
            $model->recordAudit('deleted', $model->auditValues($model->getOriginal()), []);
        });
    }

    /**
     * @return MorphMany<AuditLog, $this>
     */
    public function auditLogs(): MorphMany
    {
        return $this->morphMany(AuditLog::class, 'auditable');
    }

    /**
     * @return Collection<int, AuditLog>
     */
    public function getAuditHistory(): Collection
    {
        return $this->auditLogs()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();
    }

    /**
     * @param  array<string, mixed>  $oldValues
     * @param  array<string, mixed>  $newValues
     */
    protected function recordAudit(string $event, array $oldValues, array $newValues): void
    {
        $request = request();

        $this->auditLogs()->create([
            'event' => $event,
            'old_values' => $oldValues === [] ? null : $oldValues,
            'new_values' => $newValues === [] ? null : $newValues,
            'user_id' => Auth::id(),
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @param  array<int, string>|null  $onlyKeys
     * @return array<string, mixed>
     */
    protected function auditValues(array $attributes, ?array $onlyKeys = null): array
    {
        if ($onlyKeys !== null) {
            $attributes = array_intersect_key($attributes, array_flip($onlyKeys));
        }

        return collect($attributes)
            ->except($this->auditExcludedAttributes())
            ->all();
    }

    /**
     * @return array<int, string>
     */
    protected function auditExcludedAttributes(): array
    {
        return ['password', 'remember_token'];
    }
}
