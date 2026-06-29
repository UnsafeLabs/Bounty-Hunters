<?php

namespace App\Jobs;

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

    public int $tries = 5;

    public function __construct(private readonly int $deliveryId)
    {
        //
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = WebhookDelivery::query()->find($this->deliveryId);

        if (! $delivery instanceof WebhookDelivery) {
            return;
        }

        if (! $dispatcher->attemptDelivery($delivery)) {
            return;
        }

        $delivery->refresh();

        $delay = $delivery->next_retry_at
            ? max(0, now()->diffInSeconds($delivery->next_retry_at, false))
            : WebhookDispatcher::retryDelaySeconds($delivery->attempts);

        $this->release($delay);
    }

    /**
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return [
            WebhookDispatcher::retryDelaySeconds(1),
            WebhookDispatcher::retryDelaySeconds(2),
            WebhookDispatcher::retryDelaySeconds(3),
            WebhookDispatcher::retryDelaySeconds(4),
        ];
    }
}
