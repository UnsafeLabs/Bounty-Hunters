<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;

class WebhookDispatcher
{
    public const MAX_ATTEMPTS = 5;

    /**
     * @param  array<string, mixed>  $payload
     * @return Collection<int, WebhookDelivery>
     */
    public function dispatch(string $event, array $payload): Collection
    {
        return Webhook::active()
            ->get()
            ->filter(fn (Webhook $webhook): bool => $webhook->listensTo($event))
            ->map(function (Webhook $webhook) use ($event, $payload): WebhookDelivery {
                $delivery = $this->createDelivery($webhook, $event, $payload);

                DispatchWebhookJob::dispatch($delivery->id);

                return $delivery;
            })
            ->values();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function createDelivery(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        return $webhook->deliveries()->create([
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);
    }

    public function send(WebhookDelivery $delivery): WebhookDelivery
    {
        $delivery->loadMissing('webhook');

        $webhook = $delivery->webhook;
        $payload = $delivery->payload ?? [];
        $encodedPayload = $this->encodePayload($payload);
        $attempts = $delivery->attempts + 1;
        $responseCode = null;
        $deliveredAt = null;

        try {
            $response = Http::withHeaders([
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
                'X-Webhook-Event' => $delivery->event,
                'X-Webhook-Signature' => $this->generateSignature($webhook->secret, $encodedPayload),
            ])->withBody($encodedPayload, 'application/json')->post($webhook->url);

            $responseCode = $response->status();
            $deliveredAt = $response->successful() ? CarbonImmutable::now() : null;
        } catch (ConnectionException) {
            $responseCode = null;
        }

        $delivery->forceFill([
            'response_code' => $responseCode,
            'attempts' => $attempts,
            'next_retry_at' => $deliveredAt === null && $attempts < self::MAX_ATTEMPTS
                ? $this->calculateNextRetryAt($attempts)
                : null,
            'delivered_at' => $deliveredAt,
        ])->save();

        return $delivery->refresh();
    }

    /**
     * @param  array<string, mixed>|string  $payload
     */
    public function generateSignature(string $secret, array|string $payload): string
    {
        return hash_hmac(
            'sha256',
            is_string($payload) ? $payload : $this->encodePayload($payload),
            $secret
        );
    }

    /**
     * @param  array<string, mixed>|string  $payload
     */
    public function verifySignature(string $secret, array|string $payload, string $signature): bool
    {
        return hash_equals($this->generateSignature($secret, $payload), $signature);
    }

    public function calculateBackoffSeconds(int $attempt): int
    {
        return 2 ** max(1, $attempt);
    }

    public function calculateNextRetryAt(int $attempt): CarbonImmutable
    {
        return CarbonImmutable::now()->addSeconds($this->calculateBackoffSeconds($attempt));
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function encodePayload(array $payload): string
    {
        return json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
