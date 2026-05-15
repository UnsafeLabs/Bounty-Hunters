<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Str;

class WebhookDispatcher
{
    public function __construct(
        private HttpFactory $http,
    ) {}

    public function signPayload(array $payload, string $secret): string
    {
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return hash_hmac('sha256', $json, $secret);
    }

    public function dispatch(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $signature = $this->signPayload($payload, $webhook->secret);

        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        $response = $this->http
            ->withHeaders([
                'X-Webhook-Signature' => $signature,
                'X-Webhook-Event' => $event,
                'Content-Type' => 'application/json',
            ])
            ->timeout(10)
            ->post($webhook->url, $payload);

        $delivery->update([
            'response_code' => $response->status(),
            'attempts' => 1,
            'delivered_at' => $response->successful() ? now() : null,
            'next_retry_at' => $response->failed() ? $this->calculateNextRetry(1) : null,
        ]);

        return $delivery;
    }

    public function calculateNextRetry(int $attempt): \DateTimeInterface
    {
        $delay = (int)(2 ** $attempt);

        return now()->addSeconds($delay);
    }
}
