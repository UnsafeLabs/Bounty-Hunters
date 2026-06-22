<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class AuditLog extends Model
{
    protected $fillable = [
        "auditable_type", "auditable_id", "event",
        "old_values", "new_values", "user_id",
        "ip_address", "user_agent",
    ];

    protected $casts = [
        "old_values" => "json",
        "new_values" => "json",
    ];

    public function auditable(): MorphTo
    {
        return $this->morphTo();
    }
}
