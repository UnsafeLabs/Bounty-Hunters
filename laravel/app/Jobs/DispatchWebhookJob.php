<?php

namespace App\Jobs;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class DispatchWebhookJob implements ShouldQueue
{
    use InteractsWithQueue, Queueable;

    public int $tries = 5;

    public int $backoff = 2;

    public function __construct(
        public int $webhookId,
        public string $event,
        public array $payload,
    ) {}

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $webhook = Webhook::find($this->webhookId);

        if (!$webhook || !$webhook->active) {
            return;
        }

        if (!in_array($this->event, $webhook->events)) {
            return;
        }

        $dispatcher->dispatch($webhook, $this->event, $this->payload);
    }

    public function retryUntil(): \DateTimeInterface
    {
        return now()->addMinutes(30);
    }
}
