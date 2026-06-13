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

    public function __construct(public WebhookDelivery $delivery)
    {
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        $dispatcher = new WebhookDispatcher();

        return [
            $dispatcher->retryDelaySeconds(1),
            $dispatcher->retryDelaySeconds(2),
            $dispatcher->retryDelaySeconds(3),
            $dispatcher->retryDelaySeconds(4),
            $dispatcher->retryDelaySeconds(5),
        ];
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $dispatcher->send($this->delivery);
    }
}
