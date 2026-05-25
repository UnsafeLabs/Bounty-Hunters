<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WebhookDispatcher
{
    public function dispatch(Webhook $webhook, string $event, array $payload): bool
    {
        $signature = hash_hmac('sha256', json_encode($payload), $webhook->secret);
        $headers = [
            'X-Webhook-Signature' => $signature,
            'Content-Type' => 'application/json',
        ];

        try {
            $response = Http::withHeaders($headers)
                ->post($webhook->url, $payload);

            $delivery = new WebhookDelivery();
            $delivery->webhook_id = $webhook->id;
            $delivery->event = $event;
            $delivery->payload = $payload;
            $delivery->response_code = $response->status();
            $delivery->attempts = 1;
            $delivery->delivered_at = now();
            $delivery->save();

            return $response->successful();
        } catch (\Exception $e) {
            Log::error("Webhook delivery failed: " . $e->getMessage());
            return false;
        }
    }

    public function calculateHmacSignature(string $payload, string $secret): string
    {
        return hash_hmac('sha256', $payload, $secret);
    }

    public function shouldRetryDelivery(WebhookDelivery $delivery): bool
    {
        return $delivery->attempts < 5;
    }

    public function calculateNextRetryDelay(int $attempt): int
    {
        return pow(2, $attempt - 1) * 60; // Exponential backoff in seconds
    }
}

?>