<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;

class WebhookDispatcher
{
    const MAX_RETRIES = 5;
    const RETRY_BACKOFF = [5, 15, 60, 300, 900]; // seconds

    /**
     * Dispatch a webhook event to all matching webhooks.
     */
    public function dispatch(string $event, array $payload): void
    {
        $webhooks = Webhook::where('active', true)
            ->whereJsonContains('events', $event)
            ->get();

        foreach ($webhooks as $webhook) {
            $this->sendWebhook($webhook, $event, $payload);
        }
    }

    /**
     * Send to a single webhook with signature and retry.
     */
    private function sendWebhook(Webhook $webhook, string $event, array $payload): void
    {
        $body = json_encode($payload);
        $signature = hash_hmac('sha256', $body, $webhook->secret);

        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
            'next_retry_at' => now()->addSeconds(self::RETRY_BACKOFF[0] ?? 60),
        ]);

        $this->attempt($webhook, $delivery, $body, $signature, 1);
    }

    /**
     * Attempt delivery with retry/backoff.
     */
    private function attempt(Webhook $webhook, WebhookDelivery $delivery, string $body, string $signature, int $attempt): void
    {
        try {
            $response = Http::timeout(10)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-Webhook-Signature' => 'sha256=' . $signature,
                    'X-Webhook-Event' => $delivery->event,
                    'X-Webhook-Delivery-ID' => (string) $delivery->id,
                ])
                ->send('POST', $webhook->url, ['body' => $body]);

            $delivery->response_code = $response->status();
            $delivery->attempts = $attempt;

            if ($response->successful()) {
                $delivery->delivered_at = now();
                $delivery->next_retry_at = null;
                $delivery->save();
                return;
            }

            if ($response->serverError() || $response->status() === 429) {
                $this->scheduleRetry($delivery, $attempt);
            } else {
                $delivery->next_retry_at = null;
                $delivery->save();
            }
        } catch (\Exception $e) {
            $delivery->attempts = $attempt;
            $this->scheduleRetry($delivery, $attempt);
        }
    }

    /**
     * Schedule a retry with exponential backoff.
     */
    private function scheduleRetry(WebhookDelivery $delivery, int $attempt): void
    {
        if ($attempt >= self::MAX_RETRIES) {
            $delivery->next_retry_at = null;
        } else {
            $delay = self::RETRY_BACKOFF[$attempt - 1] ?? 900;
            $delivery->next_retry_at = now()->addSeconds($delay);
        }
        $delivery->save();
    }

    /**
     * Process pending retries (intended for scheduled task).
     */
    public function processRetries(): int
    {
        $pending = WebhookDelivery::whereNull('delivered_at')
            ->where('next_retry_at', '<=', now())
            ->where('attempts', '<', self::MAX_RETRIES)
            ->get();

        $processed = 0;
        foreach ($pending as $delivery) {
            $webhook = $delivery->webhook;
            $body = json_encode($delivery->payload);
            $signature = hash_hmac('sha256', $body, $webhook->secret);
            $this->attempt($webhook, $delivery, $body, $signature, $delivery->attempts + 1);
            $processed++;
        }

        return $processed;
    }
}
