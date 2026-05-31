<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class DispatchWebhookJob implements ShouldQueue
{
    use Queueable;

    public int $tries = WebhookDispatcher::MAX_ATTEMPTS;

    public function __construct(
        public readonly int $deliveryId,
    ) {}

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = WebhookDelivery::query()->findOrFail($this->deliveryId);

        if ($delivery->delivered_at !== null) {
            return;
        }

        $dispatcher->send($delivery);
    }

    /**
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return WebhookDispatcher::backoffSchedule();
    }
}
