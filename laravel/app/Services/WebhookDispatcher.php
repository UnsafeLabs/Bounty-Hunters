<?php

namespace App\Services;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WebhookDispatcher
{
    protected const MAX_RETRIES = 3;
    protected const RETRY_DELAYS = [10, 60, 300]; // seconds

    public function dispatch(Webhook $webhook, string $event, array $payload): WebhookDelivery
    {
        $delivery = new WebhookDelivery();
        $delivery->webhook_id = $webhook->id;
        $delivery->event = $event;
        $delivery->payload = $payload;
        $delivery->attempts = 0;
        $delivery->save();

        $this->attemptDelivery($webhook, $delivery, $payload);
        return $delivery;
    }

    protected function attemptDelivery(Webhook $webhook, WebhookDelivery $delivery, array $payload): void
    {
        $signature = hash_hmac('sha256', json_encode($payload), $webhook->secret);

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'X-Webhook-Signature' => $signature,
                'X-Webhook-Event' => $delivery->event,
                'X-Webhook-Delivery' => $delivery->id,
            ])->timeout(10)->post($webhook->url, $payload);

            $delivery->response_code = $response->status();
            $delivery->attempts++;

            if ($response->successful()) {
                $delivery->delivered_at = now();
            } elseif ($delivery->attempts < self::MAX_RETRIES) {
                $delay = self::RETRY_DELAYS[$delivery->attempts - 1] ?? 300;
                $delivery->next_retry_at = now()->addSeconds($delay);
            }

            $delivery->save();
        } catch (\Exception $e) {
            Log::error("Webhook delivery failed: {$e->getMessage()}", ['webhook_id' => $webhook->id]);
            $delivery->attempts++;
            if ($delivery->attempts < self::MAX_RETRIES) {
                $delivery->next_retry_at = now()->addSeconds(self::RETRY_DELAYS[$delivery->attempts - 1] ?? 300);
            }
            $delivery->save();
        }
    }

    public function retryFailed(): void
    {
        $pending = WebhookDelivery::whereNull('delivered_at')
            ->where('attempts', '<', self::MAX_RETRIES)
            ->where('next_retry_at', '<=', now())
            ->get();

        foreach ($pending as $delivery) {
            $webhook = $delivery->webhook;
            if ($webhook && $webhook->active) {
                $this->attemptDelivery($webhook, $delivery, $delivery->payload);
            }
        }
    }
}
