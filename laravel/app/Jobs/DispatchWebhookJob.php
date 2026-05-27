<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use RuntimeException;

class DispatchWebhookJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public int $deliveryId)
    {
        $this->onQueue('webhooks');
    }

    /**
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return [60, 300, 900, 1800];
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = WebhookDelivery::query()->findOrFail($this->deliveryId);

        if ($delivery->delivered()) {
            return;
        }

        if (! $dispatcher->deliver($delivery)) {
            throw new RuntimeException("Webhook delivery {$delivery->id} failed.");
        }
    }
}
