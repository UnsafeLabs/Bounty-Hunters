<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Throwable;

class WebhookDispatcher
{
    public const MAX_ATTEMPTS = 5;

    public const INITIAL_RETRY_DELAY_SECONDS = 60;

    /**
     * @param array<string, mixed> $payload
     *
     * @return Collection<int, WebhookDelivery>
     */
    public function dispatch(string $event, array $payload): Collection
    {
        return Webhook::query()
            ->where('active', true)
            ->get()
            ->filter(fn (Webhook $webhook): bool => $webhook->listensFor($event))
            ->map(fn (Webhook $webhook): WebhookDelivery => $this->queueDelivery($webhook, $event, $payload))
            ->values();
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function queueDelivery(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = $webhook->deliveries()->create([
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        DispatchWebhookJob::dispatch($delivery->id);

        return $delivery;
    }

    public function attemptDelivery(WebhookDelivery $delivery): bool
    {
        $delivery->loadMissing('webhook');

        if (! $delivery->webhook instanceof Webhook || ! $delivery->webhook->active) {
            return false;
        }

        $attempts = $delivery->attempts + 1;
        $body = self::encodePayload($delivery->event, $delivery->payload ?? []);
        $responseCode = null;
        $successful = false;

        try {
            $response = Http::timeout(10)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-Webhook-Delivery' => (string) $delivery->id,
                    'X-Webhook-Event' => $delivery->event,
                    'X-Webhook-Signature' => self::signatureFor($body, $delivery->webhook->secret),
                ])
                ->withBody($body, 'application/json')
                ->post($delivery->webhook->url);

            $responseCode = $response->status();
            $successful = $response->successful();
        } catch (ConnectionException) {
            $successful = false;
        } catch (Throwable $exception) {
            report($exception);
            $successful = false;
        }

        if ($successful) {
            $delivery->forceFill([
                'response_code' => $responseCode,
                'attempts' => $attempts,
                'next_retry_at' => null,
                'delivered_at' => Carbon::now(),
            ])->save();

            return false;
        }

        $shouldRetry = $attempts < self::MAX_ATTEMPTS;

        $delivery->forceFill([
            'response_code' => $responseCode,
            'attempts' => $attempts,
            'next_retry_at' => $shouldRetry ? Carbon::now()->addSeconds(self::retryDelaySeconds($attempts)) : null,
            'delivered_at' => null,
        ])->save();

        return $shouldRetry;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function encodePayload(string $event, array $payload): string
    {
        return json_encode([
            'event' => $event,
            'payload' => $payload,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    public static function signatureFor(string $body, string $secret): string
    {
        return 'sha256='.hash_hmac('sha256', $body, $secret);
    }

    public static function verifySignature(string $body, string $secret, string $signature): bool
    {
        return hash_equals(self::signatureFor($body, $secret), $signature);
    }

    public static function retryDelaySeconds(int $failedAttempt): int
    {
        return self::INITIAL_RETRY_DELAY_SECONDS * (2 ** max(0, $failedAttempt - 1));
    }
}
