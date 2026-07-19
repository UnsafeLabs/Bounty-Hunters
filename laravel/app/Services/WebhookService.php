<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Models\Webhook;

class WebhookService
{
    public function dispatch(string $event, array $payload, ?int $userId = null): void
    {
        $webhooks = Webhook::where('event', $event)->where('active', true)->get();

        foreach ($webhooks as $webhook) {
            $this->send($webhook, $event, $payload);
        }
    }

    public function send(Webhook $webhook, string $event, array $payload): void
    {
        $signature = hash_hmac('sha256', json_encode($payload), $webhook->secret);
        $maxRetries = 3;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                $response = Http::withHeaders([
                    'X-Webhook-Event' => $event,
                    'X-Webhook-Signature' => $signature,
                ])->timeout(10)->post($webhook->url, $payload);

                if ($response->successful()) {
                    $webhook->increment('success_count');
                    return;
                }

                Log::warning("Webhook failed attempt {$attempt}", [
                    'url' => $webhook->url,
                    'status' => $response->status(),
                ]);
            } catch (\Exception $e) {
                Log::error("Webhook error attempt {$attempt}: {$e->getMessage()}");
            }

            if ($attempt < $maxRetries) {
                usleep(500000 * pow(2, $attempt));
            }
        }

        $webhook->increment('failure_count');
    }
}
