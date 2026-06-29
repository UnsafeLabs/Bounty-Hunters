<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['url', 'secret', 'events', 'active'])]
#[Hidden(['secret'])]
class Webhook extends Model
{
    /**
     * @return HasMany<WebhookDelivery>
     */
    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class);
    }

    public function listensFor(string $event): bool
    {
        $events = $this->events ?? [];

        return in_array('*', $events, true) || in_array($event, $events, true);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'events' => 'array',
        ];
    }
}
