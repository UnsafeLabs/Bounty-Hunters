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
            $model->recordAudit("created", [], $model->getAuditableValues());
        });

        static::updated(function ($model) {
            $changed = $model->getDirty();
            $old = [];
            $new = [];
            foreach ($changed as $key => $val) {
                if (in_array($key, $model->getAuditExcludedFields())) {
                    continue;
                }
                $old[$key] = $model->getOriginal($key);
                $new[$key] = $val;
            }
            if (!empty($new)) {
                $model->recordAudit("updated", $old, $new);
            }
        });

        static::deleted(function ($model) {
            $model->recordAudit("deleted", $model->getAuditableValues(), []);
        });
    }

    protected function getAuditableValues(): array
    {
        $excluded = $this->getAuditExcludedFields();
        return collect($this->getAttributes())
            ->except($excluded)
            ->toArray();
    }

    protected function getAuditExcludedFields(): array
    {
        return ["password", "remember_token", "updated_at"];
    }

    public function recordAudit(string $event, array $oldValues, array $newValues): void
    {
        $user = Auth::user();
        $request = Request::instance();

        $this->auditLogs()->create([
            "event" => $event,
            "old_values" => $oldValues,
            "new_values" => $newValues,
            "user_id" => $user?->id,
            "ip_address" => $request?->ip(),
            "user_agent" => $request?->userAgent(),
        ]);
    }

    public function auditLogs()
    {
        return $this->morphMany(AuditLog::class, "auditable");
    }

    public function getAuditHistory()
    {
        return $this->auditLogs()->orderBy("created_at", "desc")->get();
    }
}
