<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;

class WebhookDispatcher
{
    public function dispatch(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        $this->send($delivery);

        return $delivery->fresh();
    }

    public function send(WebhookDelivery $delivery): void
    {
        $webhook = $delivery->webhook;
        $body = json_encode($delivery->payload);
        $signature = $this->sign($body, $webhook->secret);

        $delivery->increment('attempts');

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'X-Webhook-Signature' => $signature,
            ])->send('POST', $webhook->url, ['body' => $body]);

            $delivery->update([
                'response_code' => $response->status(),
                'delivered_at' => $response->successful() ? now() : null,
            ]);
        } catch (\Throwable) {
            $delivery->update(['response_code' => null]);
        }
    }

    public function sign(string $payload, string $secret): string
    {
        return hash_hmac('sha256', $payload, $secret);
    }

    public function nextRetryAt(int $attempts): \DateTimeInterface
    {
        return now()->addSeconds((int) (60 * (2 ** ($attempts - 1))));
    }
}
