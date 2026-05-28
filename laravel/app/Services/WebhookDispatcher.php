<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Jobs\DispatchWebhookJob;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Crypt;

class WebhookDispatcher
{
    /**
     * Dispatch a webhook event to all active webhooks that match the event.
     *
     * @param string $event The event name (e.g., 'order.created')
     * @param array $payload The event payload
     * @return int Number of webhooks queued for delivery
     */
    public function dispatch(string $event, array $payload): int
    {
        $webhooks = Webhook::where('active', true)
            ->whereJsonContains('events', $event)
            ->get();

        foreach ($webhooks as $webhook) {
            $delivery = WebhookDelivery::create([
                'webhook_id' => $webhook->id,
                'event' => $event,
                'payload' => $payload,
                'attempts' => 0,
            ]);

            DispatchWebhookJob::dispatch($delivery->id);
        }

        return $webhooks->count();
    }

    /**
     * Send a POST request to the webhook URL with HMAC-SHA256 signature.
     *
     * @param Webhook $webhook
     * @param array $payload
     * @return array Result with success status, response code, and body
     */
    public function send(Webhook $webhook, array $payload): array
    {
        $timestamp = now()->timestamp;
        $signature = $this->generateSignature($webhook->secret, $payload, $timestamp);

        $response = Http::withHeaders([
            'Content-Type' => 'application/json',
            'X-Webhook-Signature' => $signature,
            'X-Webhook-Timestamp' => $timestamp,
        ])
            ->timeout(30)
            ->post($webhook->url, $payload);

        return [
            'success' => $response->successful(),
            'response_code' => $response->status(),
            'body' => $response->body(),
        ];
    }

    /**
     * Generate HMAC-SHA256 signature for webhook payload.
     *
     * @param string $secret
     * @param array $payload
     * @param int $timestamp
     * @return string
     */
    protected function generateSignature(string $secret, array $payload, int $timestamp): string
    {
        $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $message = $timestamp . '.' . $payloadJson;
        return 'sha256=' . hash_hmac('sha256', $message, $secret);
    }

    /**
     * Verify incoming webhook signature.
     *
     * @param string $secret
     * @param array $payload
     * @param string $signature
     * @param int $timestamp
     * @param int $tolerance Maximum age of timestamp in seconds
     * @return bool
     */
    public function verifySignature(
        string $secret,
        array $payload,
        string $signature,
        int $timestamp,
        int $tolerance = 300
    ): bool {
        // Check timestamp tolerance
        if (abs(now()->timestamp - $timestamp) > $tolerance) {
            return false;
        }

        $expected = $this->generateSignature($secret, $payload, $timestamp);
        return hash_equals($expected, $signature);
    }
}
