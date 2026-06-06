<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Bus\Dispatchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class DispatchWebhookJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = WebhookDispatcher::MAX_ATTEMPTS;

    public function __construct(public WebhookDelivery $delivery)
    {
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = $this->delivery->fresh(['webhook']) ?? $this->delivery->load('webhook');

        $dispatcher->send($delivery);
    }

    public function backoff(): array
    {
        return [60, 120, 240, 480, 960];
    }
}
