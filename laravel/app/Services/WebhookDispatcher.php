<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WebhookDispatcher
{
    public function dispatch(string $event, array $payload): void
    {
        $webhooks = Webhook::active()->get()->filter(function ($webhook) use ($event) {
            return in_array($event, $webhook->events ?? []);
        });

        foreach ($webhooks as $webhook) {
            $this->deliver($webhook, $event, $payload);
        }
    }

    public function deliver(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        $this->attemptDelivery($delivery, $webhook);
        return $delivery;
    }

    protected function attemptDelivery(WebhookDelivery $delivery, Webhook $webhook): void
    {
        $payloadJson = json_encode($delivery->payload);
        $timestamp = now()->unix();
        $signature = $this->computeSignature($payloadJson, $timestamp, $webhook->secret);

        try {
            $response = Http::withHeaders([
                'X-Webhook-Signature' => $signature,
                'X-Webhook-Timestamp' => $timestamp,
                'X-Webhook-Event' => $delivery->event,
                'Content-Type' => 'application/json',
            ])->timeout(10)->post($webhook->url, $delivery->payload);

            $delivery->update([
                'response_code' => $response->status(),
                'attempts' => $delivery->attempts + 1,
                'delivered_at' => $response->successful() ? now() : null,
                'next_retry_at' => $response->successful() ? null : $this->getNextRetryAt($delivery->attempts + 1),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Webhook delivery failed", [
                'delivery_id' => $delivery->id,
                'error' => $e->getMessage(),
            ]);
            $delivery->update([
                'attempts' => $delivery->attempts + 1,
                'next_retry_at' => $this->getNextRetryAt($delivery->attempts + 1),
            ]);
        }
    }

    public function processRetries(): int
    {
        $pending = WebhookDelivery::whereNull('delivered_at')
            ->where('attempts', '<', 3)
            ->where('next_retry_at', '<=', now())
            ->get();

        $processed = 0;
        foreach ($pending as $delivery) {
            $this->attemptDelivery($delivery, $delivery->webhook);
            $processed++;
        }
        return $processed;
    }

    public function computeSignature(string $payload, int $timestamp, string $secret): string
    {
        $signedPayload = "{$timestamp}.{$payload}";
        return hash_hmac('sha256', $signedPayload, $secret);
    }

    public function verifySignature(string $payload, string $signature, int $timestamp, string $secret, int $tolerance = 300): bool
    {
        if (abs(now()->unix() - $timestamp) > $tolerance) {
            return false;
        }
        $expected = $this->computeSignature($payload, $timestamp, $secret);
        return hash_equals($expected, $signature);
    }

    protected function getNextRetryAt(int $attempts): ?string
    {
        if ($attempts >= 3) {
            return null;
        }
        $delay = pow(2, $attempts) * 60;
        return now()->addSeconds($delay)->toDateTimeString();
    }
}
