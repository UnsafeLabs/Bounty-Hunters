<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class WebhookDispatcher
{
    public const MAX_ATTEMPTS = 5;

    /**
     * @param  array<string, mixed>  $payload
     * @return list<WebhookDelivery>
     */
    public function dispatch(string $event, array $payload): array
    {
        $deliveries = [];

        Webhook::query()
            ->where('active', true)
            ->whereJsonContains('events', $event)
            ->each(function (Webhook $webhook) use ($event, $payload, &$deliveries): void {
                $delivery = $webhook->deliveries()->create([
                    'event' => $event,
                    'payload' => $payload,
                    'attempts' => 0,
                ]);

                DispatchWebhookJob::dispatch($delivery);
                $deliveries[] = $delivery;
            });

        return $deliveries;
    }

    public function send(WebhookDelivery $delivery): WebhookDelivery
    {
        $delivery->loadMissing('webhook');
        $webhook = $delivery->webhook;

        if (! $webhook instanceof Webhook || ! $webhook->active) {
            throw new RuntimeException('Webhook is inactive or missing.');
        }

        $body = $this->bodyForDelivery($delivery);
        $response = $this->post($webhook, $body);
        $attempts = $delivery->attempts + 1;

        $delivery->forceFill([
            'response_code' => $response->status(),
            'attempts' => $attempts,
            'delivered_at' => $response->successful() ? now() : null,
            'next_retry_at' => $response->successful()
                ? null
                : now()->addSeconds($this->retryDelaySeconds($attempts)),
        ])->save();

        if ($response->failed()) {
            throw new RuntimeException("Webhook delivery failed with HTTP {$response->status()}.");
        }

        return $delivery;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function signatureForPayload(string $secret, array $payload): string
    {
        return hash_hmac('sha256', $this->canonicalJson($payload), $secret);
    }

    public function retryDelaySeconds(int $attempt): int
    {
        return 60 * (2 ** max(0, $attempt - 1));
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function post(Webhook $webhook, array $body): Response
    {
        return Http::asJson()
            ->withHeaders([
                'X-Webhook-Signature' => $this->signatureForPayload($webhook->secret, $body),
                'X-Webhook-Event' => $body['event'],
            ])
            ->timeout(10)
            ->post($webhook->url, $body);
    }

    /**
     * @return array{event: string, payload: array<string, mixed>}
     */
    private function bodyForDelivery(WebhookDelivery $delivery): array
    {
        return [
            'event' => $delivery->event,
            'payload' => $delivery->payload ?? [],
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function canonicalJson(array $payload): string
    {
        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
