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

    public int $tries = 1;

    public function __construct(public readonly WebhookDelivery $delivery) {}

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $dispatcher->send($this->delivery);

        $this->delivery->refresh();

        if (!$this->delivery->delivered_at && $this->delivery->attempts < 5) {
            $retryAt = $dispatcher->nextRetryAt($this->delivery->attempts);
            $this->delivery->update(['next_retry_at' => $retryAt]);
            static::dispatch($this->delivery)->delay($retryAt);
        }
    }
}
