<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class WebhookDispatcher
{
    /**
     * The header carrying the HMAC-SHA256 signature of the request body.
     */
    public const SIGNATURE_HEADER = 'X-Webhook-Signature';

    /**
     * Queue an asynchronous delivery of the given event to a webhook.
     *
     * A delivery record is created up front so its identity (and attempt
     * count) survives across queue retries.
     *
     * @param  array<string, mixed>  $payload
     */
    public function queue(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = $webhook->deliveries()->create([
            'event' => $event,
            'payload' => $payload,
            'attempts' => 0,
        ]);

        DispatchWebhookJob::dispatch($delivery->id);

        return $delivery;
    }

    /**
     * Attempt a single synchronous delivery and record the outcome.
     *
     * On success the response code and delivered_at timestamp are stored. On
     * failure the attempt is recorded with the next retry time and a
     * RuntimeException is thrown so the queue worker retries the job.
     */
    public function send(WebhookDelivery $delivery): WebhookDelivery
    {
        $webhook = $delivery->webhook;

        $body = $this->body($delivery);
        $signature = $this->sign($body, $webhook->secret);

        $delivery->attempts++;
        $delivery->delivered_at = null;

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                self::SIGNATURE_HEADER => $signature,
            ])->withBody($body, 'application/json')->post($webhook->url);

            $delivery->response_code = $response->status();
            $delivered = $response->successful();
        } catch (Throwable $e) {
            $delivery->response_code = null;
            $delivered = false;
        }

        if ($delivered) {
            $delivery->delivered_at = now();
            $delivery->next_retry_at = null;
            $delivery->save();

            return $delivery;
        }

        $delivery->next_retry_at = $delivery->attempts < DispatchWebhookJob::MAX_ATTEMPTS
            ? now()->addSeconds(DispatchWebhookJob::backoffFor($delivery->attempts))
            : null;
        $delivery->save();

        throw new RuntimeException(sprintf(
            'Webhook %d delivery failed (attempt %d, response %s).',
            $webhook->id,
            $delivery->attempts,
            $delivery->response_code ?? 'none'
        ));
    }

    /**
     * Compute the HMAC-SHA256 signature of a payload using the webhook secret.
     */
    public function sign(string $payload, string $secret): string
    {
        return hash_hmac('sha256', $payload, $secret);
    }

    /**
     * The canonical JSON request body for a delivery.
     */
    protected function body(WebhookDelivery $delivery): string
    {
        return json_encode([
            'event' => $delivery->event,
            'payload' => $delivery->payload,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }
}
