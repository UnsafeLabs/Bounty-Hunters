<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Carbon;

class WebhookDispatcher
{
    public const MAX_ATTEMPTS = 5;

    /**
     * HMAC-SHA256 signature of the raw JSON body, hex-encoded.
     */
    public static function sign(string $secret, string $rawBody): string
    {
        return hash_hmac('sha256', $rawBody, $secret);
    }

    /**
     * Exponential backoff seconds for attempt N (1-based): 2^(n-1) minutes in seconds.
     * attempt 1 -> immediate (0), 2 -> 60s, 3 -> 120s, 4 -> 240s, 5 -> 480s
     */
    public static function retryDelaySeconds(int $attempt): int
    {
        if ($attempt <= 1) {
            return 0;
        }

        return (int) (60 * (2 ** ($attempt - 2)));
    }

    public static function nextRetryAt(int $attempt, ?Carbon $from = null): ?Carbon
    {
        if ($attempt >= self::MAX_ATTEMPTS) {
            return null;
        }
        $from = $from ?? Carbon::now();
        $delay = self::retryDelaySeconds($attempt + 1);

        return $from->copy()->addSeconds($delay);
    }

    /**
     * Dispatch a webhook event: POST JSON, sign body, record delivery.
     */
    public function dispatch(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        return $this->attempt($webhook, $delivery);
    }

    public function attempt(Webhook $webhook, WebhookDelivery $delivery): WebhookDelivery
    {
        $body = json_encode([
            'event' => $delivery->event,
            'payload' => $delivery->payload,
            'delivery_id' => $delivery->id,
        ], JSON_THROW_ON_ERROR);

        $signature = self::sign($webhook->secret, $body);
        $attempt = (int) $delivery->attempts + 1;

        $responseCode = null;
        try {
            $response = Http::timeout(10)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-Webhook-Signature' => $signature,
                    'X-Webhook-Event' => $delivery->event,
                ])
                ->withBody($body, 'application/json')
                ->post($webhook->url);

            $responseCode = $response->status();
            $ok = $response->successful();
        } catch (\Throwable $e) {
            $ok = false;
            $responseCode = null;
        }

        $delivery->attempts = $attempt;
        $delivery->response_code = $responseCode;

        if ($ok) {
            $delivery->delivered_at = Carbon::now();
            $delivery->next_retry_at = null;
        } else {
            $delivery->next_retry_at = self::nextRetryAt($attempt);
        }

        $delivery->save();

        return $delivery;
    }
}
