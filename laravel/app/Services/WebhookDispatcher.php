<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;

class WebhookDispatcher
{
    public const MAX_ATTEMPTS = 5;

    public function dispatch(string $event, array $payload): void
    {
        Webhook::query()
            ->where('active', true)
            ->get()
            ->filter(fn (Webhook $webhook) => $webhook->listensFor($event))
            ->each(function (Webhook $webhook) use ($event, $payload): void {
                $delivery = $webhook->deliveries()->create([
                    'event' => $event,
                    'payload' => $payload,
                    'attempts' => 0,
                ]);

                DispatchWebhookJob::dispatch($delivery);
            });
    }

    public function send(WebhookDelivery $delivery): void
    {
        $webhook = $delivery->webhook;
        $payload = $delivery->payload ?? [];
        $body = $this->canonicalPayload($delivery->event, $payload);
        $attempts = $delivery->attempts + 1;

        $response = Http::timeout(10)
            ->withHeaders([
                'X-Webhook-Event' => $delivery->event,
                'X-Webhook-Signature' => $this->signature($body, $webhook->secret),
            ])
            ->withBody($body, 'application/json')
            ->post($webhook->url);

        $delivery->forceFill([
            'attempts' => $attempts,
            'response_code' => $response->status(),
        ]);

        if ($response->successful()) {
            $delivery->delivered_at = now();
            $delivery->next_retry_at = null;
        } elseif ($attempts < self::MAX_ATTEMPTS) {
            $delivery->next_retry_at = $this->nextRetryAt($attempts);
        } else {
            $delivery->next_retry_at = null;
        }

        $delivery->save();
    }

    public function canonicalPayload(string $event, array $payload): string
    {
        return json_encode([
            'event' => $event,
            'payload' => $payload,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public function signature(string $body, string $secret): string
    {
        return 'sha256='.hash_hmac('sha256', $body, $secret);
    }

    public function nextRetryAt(int $attempts): Carbon
    {
        return now()->addSeconds($this->retryDelaySeconds($attempts));
    }

    public function retryDelaySeconds(int $attempts): int
    {
        return 2 ** max(0, $attempts - 1) * 60;
    }
}
