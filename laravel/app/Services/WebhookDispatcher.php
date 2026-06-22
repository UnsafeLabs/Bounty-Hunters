<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

class WebhookDispatcher
{
    public function dispatch(Webhook $webhook, string $event, array $payload): void
    {
        if (!$webhook->active) {
            return;
        }

        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'response_code' => null,
            'attempts' => 0,
            'next_retry_at' => now(),
        ]);

        Queue::push(new \App\Jobs\DispatchWebhookJob($webhook, $delivery));
    }

    public function signPayload(string $payload, string $secret): string
    {
        return hash_hmac('sha256', $payload, $secret);
    }
}
