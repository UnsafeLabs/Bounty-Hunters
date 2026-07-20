<?php

namespace App\Jobs;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class DispatchWebhookJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Max attempts including first try */
    public int $tries = 5;

    public function __construct(
        public int $webhookId,
        public int $deliveryId,
    ) {}

    /**
     * Exponential backoff for Laravel queue retries (seconds).
     */
    public function backoff(): array
    {
        return [
            WebhookDispatcher::retryDelaySeconds(2),
            WebhookDispatcher::retryDelaySeconds(3),
            WebhookDispatcher::retryDelaySeconds(4),
            WebhookDispatcher::retryDelaySeconds(5),
        ];
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $webhook = Webhook::query()->find($this->webhookId);
        $delivery = WebhookDelivery::query()->find($this->deliveryId);

        if (! $webhook || ! $delivery || $delivery->delivered_at !== null) {
            return;
        }

        if (! $webhook->active) {
            return;
        }

        $delivery = $dispatcher->attempt($webhook, $delivery);

        if ($delivery->delivered_at === null && $delivery->attempts < WebhookDispatcher::MAX_ATTEMPTS) {
            // Let queue retry via $tries / backoff
            $this->release(WebhookDispatcher::retryDelaySeconds($delivery->attempts + 1));
        }
    }
}
