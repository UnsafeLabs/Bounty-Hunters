<?php

namespace App\Jobs;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;

class DispatchWebhookJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $maxExceptions = 5;
    public float $backoff = 60;

    public function __construct(
        private Webhook $webhook,
        private WebhookDelivery $delivery
    ) {
    }

    public function handle(): void
    {
        $this->delivery->increment('attempts');

        $payload = json_encode(['event' => $this->delivery->event, 'data' => $this->delivery->payload]);
        $signature = $this->webhook->generateSignature($payload);

        $response = Http::timeout(30)
            ->withHeaders([
                'Content-Type' => 'application/json',
                'X-Webhook-Signature' => $signature,
                'X-Webhook-Event' => $this->delivery->event,
            ])
            ->post($this->webhook->url, json_decode($payload, true));

        $this->delivery->update([
            'response_code' => $response->status(),
            'delivered_at' => now(),
        ]);

        if ($response->successful()) {
            return;
        }

        if ($this->delivery->attempts >= 5) {
            return;
        }

        $nextBackoff = pow(2, $this->delivery->attempts) * 60;
        $this->delivery->update([
            'next_retry_at' => now()->addSeconds($nextBackoff),
        ]);

        sleep(min($nextBackoff, 3600));
        $this->dispatchAgain();
    }
}
