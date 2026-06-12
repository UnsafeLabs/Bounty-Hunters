<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WebhookDispatcher
{
    public function dispatch(Webhook $webhook, string $event, array $payload)
    {
        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        $this->send($delivery);
    }

    public function send(WebhookDelivery $delivery)
    {
        $webhook = $delivery->webhook;
        $payload = json_encode($delivery->payload);
        $signature = hash_hmac('sha256', $payload, $webhook->secret);

        $delivery->increment('attempts');

        try {
            $response = Http::withHeaders([
                'X-Webhook-Signature' => $signature,
                'Content-Type' => 'application/json',
            ])->post($webhook->url, $delivery->payload);

            $delivery->update([
                'response_code' => $response->status(),
                'delivered_at' => $response->successful() ? now() : null,
            ]);

            if (!$response->successful()) {
                $this->scheduleRetry($delivery);
            }
        } catch (\Exception $e) {
            Log::error("Webhook delivery failed: " . $e->getMessage());
            $delivery->update(['response_code' => 500]);
            $this->scheduleRetry($delivery);
        }
    }

    protected function scheduleRetry(WebhookDelivery $delivery)
    {
        if ($delivery->attempts < 5) {
            $delay = pow(2, $delivery->attempts) * 60; // Exponential backoff in minutes
            $delivery->update([
                'next_retry_at' => now()->addMinutes($delay),
            ]);
            
            // In a real app, we would dispatch a job here
            // DispatchWebhookJob::dispatch($delivery)->delay($delivery->next_retry_at);
        }
    }
}
