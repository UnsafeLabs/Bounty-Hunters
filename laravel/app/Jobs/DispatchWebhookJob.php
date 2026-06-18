<?php

namespace App\Jobs;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class DispatchWebhookJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        public int $webhookId,
        public string $event,
        public array $payload,
        public ?int $deliveryId = null,
    ) {
        //
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $webhook = Webhook::query()->findOrFail($this->webhookId);
        $delivery = $this->deliveryId ? WebhookDelivery::query()->find($this->deliveryId) : null;

        $delivery = $dispatcher->send($webhook, $this->event, $this->payload, $delivery);
        $this->deliveryId = $delivery->id;

        if ($delivery->shouldRetry($this->tries)) {
            $this->release($dispatcher->retryDelaySeconds($delivery->attempts));
        }
    }

    /**
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return [60, 120, 240, 480, 960];
    }
}
