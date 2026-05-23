<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;

class WebhookDispatcher
{
    public function dispatch(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);
        $signature = hash_hmac('sha256', json_encode($payload), $webhook->secret);
        $response = Http::withHeaders([
            'X-Webhook-Signature' => $signature,
            'X-Webhook-Event' => $event,
        ])->post($webhook->url, $payload);
        $delivery->update([
            'response_code' => $response->status(),
            'attempts' => 1,
            'delivered_at' => $response->successful() ? now() : null,
            'next_retry_at' => $response->successful() ? null : now()->addMinutes(5),
        ]);
        return $delivery->fresh();
    }

    public function retryFailed(): void
    {
        $failed = WebhookDelivery::whereNull('delivered_at')
            ->where('attempts', '<', 5)
            ->where('next_retry_at', '<=', now())
            ->get();
        foreach ($failed as $delivery) {
            $webhook = $delivery->webhook;
            if ($webhook && $webhook->active) {
                $this->dispatch($webhook, $delivery->event, $delivery->payload);
            }
        }
    }
}