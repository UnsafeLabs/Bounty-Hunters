<?php

namespace App\Services;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Http;
use JsonException;
use RuntimeException;
use Throwable;

class WebhookDispatcher
{
    public const MAX_ATTEMPTS = 5;

    /**
     * @return Collection<int, WebhookDelivery>
     */
    public function dispatchEvent(string $event, array $payload): Collection
    {
        $deliveries = new Collection;

        Webhook::query()
            ->where('active', true)
            ->get()
            ->filter(fn (Webhook $webhook): bool => in_array($event, $webhook->events ?? [], true))
            ->each(function (Webhook $webhook) use ($event, $payload, $deliveries): void {
                $delivery = $webhook->deliveries()->create([
                    'event' => $event,
                    'payload' => $payload,
                ]);

                DispatchWebhookJob::dispatch($delivery->id);
                $deliveries->push($delivery);
            });

        return $deliveries;
    }

    public function send(WebhookDelivery $delivery): WebhookDelivery
    {
        $delivery->loadMissing('webhook');

        $attempts = $delivery->attempts + 1;
        $body = $this->deliveryBody($delivery);
        $signature = $this->signature($delivery->webhook, $body);

        try {
            $response = Http::withHeaders([
                'Accept' => 'application/json',
                'X-Webhook-Event' => $delivery->event,
                'X-Webhook-Signature' => $signature,
            ])->withBody($this->jsonEncode($body), 'application/json')
                ->post($delivery->webhook->url);
        } catch (Throwable $exception) {
            $delivery->forceFill([
                'attempts' => $attempts,
                'response_code' => null,
                'next_retry_at' => $this->nextRetryAtForAttempt($attempts),
                'delivered_at' => null,
            ])->save();

            throw $exception;
        }

        $successful = $response->successful();

        $delivery->forceFill([
            'attempts' => $attempts,
            'response_code' => $response->status(),
            'next_retry_at' => $successful ? null : $this->nextRetryAtForAttempt($attempts),
            'delivered_at' => $successful ? now() : null,
        ])->save();

        if (! $successful) {
            throw new RuntimeException("Webhook delivery failed with status {$response->status()}.");
        }

        return $delivery;
    }

    public function signature(Webhook $webhook, array $body): string
    {
        return 'sha256='.hash_hmac('sha256', $this->jsonEncode($body), $webhook->secret);
    }

    public function deliveryBody(WebhookDelivery $delivery): array
    {
        return [
            'event' => $delivery->event,
            'payload' => $delivery->payload,
        ];
    }

    public function retryDelayForAttempt(int $attempt): int
    {
        return 60 * (2 ** max(0, $attempt - 1));
    }

    public function nextRetryAtForAttempt(int $attempt, ?CarbonInterface $now = null): ?CarbonImmutable
    {
        if ($attempt >= self::MAX_ATTEMPTS) {
            return null;
        }

        return CarbonImmutable::instance($now ?? now())
            ->addSeconds($this->retryDelayForAttempt($attempt));
    }

    /**
     * @return array<int, int>
     */
    public static function backoffSchedule(): array
    {
        return [60, 120, 240, 480, 960];
    }

    private function jsonEncode(array $body): string
    {
        try {
            return json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException('Unable to encode webhook payload.', previous: $exception);
        }
    }
}
