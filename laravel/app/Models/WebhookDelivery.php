<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class WebhookDelivery extends Model
{
    use HasFactory;

    protected $fillable = [
        'webhook_id',
        'event',
        'payload',
        'response_code',
        'attempts',
        'next_retry_at',
        'delivered_at',
    ];

    protected $casts = [
        'payload' => 'array',
        'next_retry_at' => 'datetime',
        'delivered_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function webhook()
    {
        return $this->belongsTo(Webhook::class);
    }
}
?>