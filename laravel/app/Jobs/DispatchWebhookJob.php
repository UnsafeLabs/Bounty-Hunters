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

    public int $tries = WebhookDispatcher::MAX_ATTEMPTS;

    public function __construct(public int $deliveryId)
    {
        //
    }

    /**
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return [2, 4, 8, 16, 32];
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = WebhookDelivery::query()->findOrFail($this->deliveryId);
        $delivery = $dispatcher->send($delivery);

        if ($delivery->delivered_at === null && $delivery->attempts < WebhookDispatcher::MAX_ATTEMPTS) {
            throw new RuntimeException("Webhook delivery {$delivery->id} failed.");
        }
    }
}
