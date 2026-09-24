<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Throwable;

class WebhookDispatcher
{
    /**
     * Number of seconds to wait before the first retry.
     */
    public const BASE_BACKOFF = 60;

    /**
     * Upper bound for a single retry delay, in seconds.
     */
    public const MAX_BACKOFF = 3600;

    /**
     * Maximum number of delivery attempts, including the initial one.
     */
    public const MAX_ATTEMPTS = 5;

    /**
     * Build the HMAC-SHA256 signature for a payload.
     *
     * The receiver recomputes this value from the raw request body and compares
     * it against the X-Webhook-Signature header to authenticate the delivery.
     */
    public function signature(string $payload, string $secret): string
    {
        return 'sha256='.hash_hmac('sha256', $payload, $secret);
    }

    /**
     * Delay before the given attempt number (1-based) should be retried.
     *
     * Exponential backoff: 60s, 120s, 240s, 480s, ... capped at one hour.
     */
    public function backoffSeconds(int $attempt): int
    {
        $attempt = max(1, $attempt);

        return (int) min(self::MAX_BACKOFF, self::BASE_BACKOFF * (2 ** ($attempt - 1)));
    }

    /**
     * Schedule the next retry for a delivery unless the attempt budget is spent.
     */
    public function scheduleRetry(WebhookDelivery $delivery): bool
    {
        if ($delivery->attempts >= self::MAX_ATTEMPTS) {
            $delivery->next_retry_at = null;
            $delivery->save();

            return false;
        }

        $delivery->next_retry_at = now()->addSeconds($this->backoffSeconds($delivery->attempts));
        $delivery->save();

        return true;
    }

    /**
     * Deliver an event to a webhook and record the attempt.
     */
    public function deliver(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = $webhook->deliveries()->create([
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        return $this->attempt($delivery);
    }

    /**
     * Perform a single delivery attempt for the given record.
     */
    public function attempt(WebhookDelivery $delivery): WebhookDelivery
    {
        $webhook = $delivery->webhook;
        $body = json_encode($delivery->payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $body = $body === false ? '{}' : $body;

        $delivery->attempts = $delivery->attempts + 1;

        $response = $this->send($webhook->url, $body, $this->signature($body, $webhook->secret));

        $delivery->response_code = $response?->status();

        if ($response !== null && $response->successful()) {
            $delivery->delivered_at = now();
            $delivery->next_retry_at = null;
        } else {
            $delivery->delivered_at = null;
            $this->scheduleRetry($delivery);

            return $delivery;
        }

        $delivery->save();

        return $delivery;
    }

    /**
     * Send the signed request, returning null when the connection itself fails.
     */
    protected function send(string $url, string $body, string $signature): ?Response
    {
        try {
            return Http::withHeaders([
                'Content-Type' => 'application/json',
                'X-Webhook-Signature' => $signature,
            ])->withBody($body, 'application/json')->post($url);
        } catch (Throwable) {
            // The receiver is unreachable; the delivery is retried with backoff.
            return null;
        }
    }
}
