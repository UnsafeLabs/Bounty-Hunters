<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class DispatchWebhookJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    public int $timeout = 60;

    protected int $deliveryId;

    public function __construct(int $deliveryId)
    {
        $this->deliveryId = $deliveryId;
    }

    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = WebhookDelivery::findOrFail($this->deliveryId);
        $webhook = $delivery->webhook;

        if (!$webhook || !$webhook->isActive()) {
            $delivery->update(['response_code' => 410]);
            return;
        }

        $result = $dispatcher->send($webhook, $delivery->payload);

        $delivery->increment('attempts');

        if ($result['success']) {
            $delivery->update([
                'response_code' => $result['response_code'],
                'delivered_at' => now(),
            ]);
            Log::info("Webhook delivered successfully", [
                'delivery_id' => $delivery->id,
                'webhook_id' => $webhook->id,
                'event' => $delivery->event,
            ]);
        } else {
            $delivery->update(['response_code' => $result['response_code']]);
            $this->scheduleRetry($delivery);
        }
    }

    protected function scheduleRetry(WebhookDelivery $delivery): void
    {
        if ($delivery->attempts >= $this->tries) {
            Log::warning("Webhook delivery failed after max attempts", [
                'delivery_id' => $delivery->id,
                'attempts' => $delivery->attempts,
            ]);
            return;
        }

        // Exponential backoff: 1min, 5min, 25min, 125min, 625min
        $delay = min(60 * pow(5, $delivery->attempts - 1), 3600 * 24);
        $delivery->update(['next_retry_at' => now()->addSeconds($delay)]);

        Log::info("Webhook retry scheduled", [
            'delivery_id' => $delivery->id,
            'attempt' => $delivery->attempts,
            'retry_at' => $delivery->next_retry_at,
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        $delivery = WebhookDelivery::find($this->deliveryId);
        if ($delivery) {
            $delivery->update(['response_code' => 500]);
        }
        Log::error("Webhook job failed", [
            'delivery_id' => $this->deliveryId,
            'error' => $exception->getMessage(),
        ]);
    }
}
