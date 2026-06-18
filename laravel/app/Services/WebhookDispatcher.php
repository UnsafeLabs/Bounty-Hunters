<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Throwable;

class WebhookDispatcher
{
    public function dispatch(string $event, array $payload): void
    {
        Webhook::query()
            ->where('active', true)
            ->get()
            ->filter(fn (Webhook $webhook): bool => in_array($event, $webhook->events ?? [], true))
            ->each(fn (Webhook $webhook) => DispatchWebhookJob::dispatch($webhook->id, $event, $payload));
    }

    public function send(Webhook $webhook, string $event, array $payload, ?WebhookDelivery $delivery = null): WebhookDelivery
    {
        $delivery ??= WebhookDelivery::query()->create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        $body = $this->canonicalPayload($payload);
        $signature = $this->signature($webhook->secret, $body);
        $attempt = $delivery->attempts + 1;

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'X-Webhook-Event' => $event,
                'X-Webhook-Signature' => $signature,
            ])->withBody($body, 'application/json')->post($webhook->url);

            $delivery->fill([
                'response_code' => $response->status(),
                'attempts' => $attempt,
                'next_retry_at' => $response->successful() ? null : $this->nextRetryAt($attempt),
                'delivered_at' => $response->successful() ? now() : null,
            ])->save();
        } catch (Throwable) {
            $delivery->fill([
                'response_code' => null,
                'attempts' => $attempt,
                'next_retry_at' => $this->nextRetryAt($attempt),
            ])->save();
        }

        return $delivery->refresh();
    }

    public function canonicalPayload(array $payload): string
    {
        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    public function signature(string $secret, string $body): string
    {
        return 'sha256='.hash_hmac('sha256', $body, $secret);
    }

    public function retryDelaySeconds(int $attempt): int
    {
        return min(3600, 60 * (2 ** max(0, $attempt - 1)));
    }

    public function nextRetryAt(int $attempt): Carbon
    {
        return now()->addSeconds($this->retryDelaySeconds($attempt));
    }
}
