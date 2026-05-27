<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use JsonException;

class WebhookDispatcher
{
    /**
     * @return array<int, WebhookDelivery>
     */
    public function dispatch(string $event, array $payload): array
    {
        return Webhook::query()
            ->where('active', true)
            ->get()
            ->filter(fn (Webhook $webhook): bool => $webhook->listensFor($event))
            ->map(function (Webhook $webhook) use ($event, $payload): WebhookDelivery {
                $delivery = $webhook->deliveries()->create([
                    'event' => $event,
                    'payload' => $payload,
                ]);

                DispatchWebhookJob::dispatch($delivery->id);

                return $delivery;
            })
            ->values()
            ->all();
    }

    /**
     * @throws ConnectionException
     * @throws JsonException
     */
    public function deliver(WebhookDelivery $delivery): bool
    {
        $delivery->loadMissing('webhook');

        $body = $this->jsonBody($delivery->payload);
        $attempt = $delivery->attempts + 1;

        try {
            $response = Http::withBody($body, 'application/json')
                ->withHeaders([
                    'X-Webhook-Event' => $delivery->event,
                    'X-Webhook-Delivery' => (string) $delivery->id,
                    'X-Webhook-Signature' => $this->signature($body, $delivery->webhook->secret),
                ])
                ->timeout(10)
                ->post($delivery->webhook->url);
        } catch (ConnectionException $exception) {
            $this->markFailedAttempt($delivery, $attempt);

            throw $exception;
        }

        if ($response->successful()) {
            $delivery->forceFill([
                'attempts' => $attempt,
                'response_code' => $response->status(),
                'next_retry_at' => null,
                'delivered_at' => now(),
            ])->save();

            return true;
        }

        $this->markFailedAttempt($delivery, $attempt, $response->status());

        return false;
    }

    public function signature(string $body, string $secret): string
    {
        return 'sha256='.hash_hmac('sha256', $body, $secret);
    }

    public function signatureIsValid(string $body, string $secret, string $signature): bool
    {
        return hash_equals($this->signature($body, $secret), $signature);
    }

    /**
     * @throws JsonException
     */
    public function jsonBody(array $payload): string
    {
        return json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    public function nextRetryAt(int $attempt): Carbon
    {
        return now()->addSeconds($this->retryDelay($attempt));
    }

    public function retryDelay(int $attempt): int
    {
        return match ($attempt) {
            1 => 60,
            2 => 300,
            3 => 900,
            default => 1800,
        };
    }

    private function markFailedAttempt(WebhookDelivery $delivery, int $attempt, ?int $status = null): void
    {
        $delivery->forceFill([
            'attempts' => $attempt,
            'response_code' => $status,
            'next_retry_at' => $this->nextRetryAt($attempt),
            'delivered_at' => null,
        ])->save();
    }
}
