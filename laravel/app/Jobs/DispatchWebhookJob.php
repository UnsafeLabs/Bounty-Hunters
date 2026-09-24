<?php

namespace App\Jobs;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use RuntimeException;

class DispatchWebhookJob implements ShouldQueue
{
    use Queueable;

    /**
     * Maximum number of times the job may be attempted.
     */
    public int $tries = WebhookDispatcher::MAX_ATTEMPTS;

    /**
     * The delivery record created by the first attempt, if any.
     */
    public ?int $deliveryId = null;

    public function __construct(
        public int $webhookId,
        public string $event,
        public array $payload,
    ) {}

    /**
     * Seconds to wait before each subsequent attempt.
     *
     * @return list<int>
     */
    public function backoff(): array
    {
        $dispatcher = app(WebhookDispatcher::class);

        return array_map(
            fn (int $attempt): int => $dispatcher->backoffSeconds($attempt),
            range(1, WebhookDispatcher::MAX_ATTEMPTS - 1),
        );
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $webhook = Webhook::find($this->webhookId);

        if ($webhook === null || ! $webhook->active) {
            return;
        }

        $delivery = $this->deliveryId === null
            ? $dispatcher->deliver($webhook, $this->event, $this->payload)
            : $dispatcher->attempt(WebhookDelivery::findOrFail($this->deliveryId));

        $this->deliveryId = $delivery->id;

        if (! $delivery->wasSuccessful()) {
            throw new RuntimeException(
                'Webhook delivery failed with response code '.($delivery->response_code ?? 'none')
            );
        }
    }
}
