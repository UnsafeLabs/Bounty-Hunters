<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

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

        $this->send($webhook, $delivery);

        return $delivery;
    }

    public function send(Webhook $webhook, WebhookDelivery $delivery): bool
    {
        $delivery->increment('attempts');

        $payload = [
            'event' => $delivery->event,
            'data' => $delivery->payload,
            'timestamp' => now()->toIso8601String(),
        ];

        $jsonPayload = json_encode($payload);
        $signature = $this->generateSignature($webhook->secret, $jsonPayload);

        try {
            $response = Http::withHeaders([
                'X-Webhook-Signature' => $signature,
                'Content-Type' => 'application/json',
                'User-Agent' => 'BountyHunters-Webhook/1.0',
            ])->timeout(30)->post($webhook->url, $payload);

            $delivery->update([
                'response_code' => $response->status(),
            ]);

            if ($response->successful()) {
                $delivery->update([
                    'delivered_at' => now(),
                    'next_retry_at' => null,
                ]);
                return true;
            }
        } catch (\Exception $e) {
            Log::error('Webhook delivery failed', [
                'webhook_id' => $webhook->id,
                'delivery_id' => $delivery->id,
                'error' => $e->getMessage(),
            ]);

            $delivery->update([
                'response_code' => 0,
            ]);
        }

        return false;
    }

    public function generateSignature(string $secret, string $payload): string
    {
        $hash = hash_hmac('sha256', $payload, $secret);
        return 'sha256=' . $hash;
    }
}