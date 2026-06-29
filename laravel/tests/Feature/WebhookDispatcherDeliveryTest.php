<?php

namespace Tests\Feature;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class WebhookDispatcherDeliveryTest extends TestCase
{
    use RefreshDatabase;

    public function test_dispatcher_creates_delivery_history_and_queues_job(): void
    {
        Queue::fake();

        Webhook::query()->create([
            'url' => 'https://example.com/webhooks',
            'secret' => 'a-very-secret-value',
            'events' => ['invoice.paid'],
            'active' => true,
        ]);

        $deliveries = (new WebhookDispatcher)->dispatch('invoice.paid', ['invoice_id' => 123]);

        $this->assertCount(1, $deliveries);
        $this->assertDatabaseHas('webhook_deliveries', [
            'event' => 'invoice.paid',
            'attempts' => 0,
        ]);
        Queue::assertPushed(DispatchWebhookJob::class);
    }

    public function test_failed_delivery_records_attempt_and_retry_time(): void
    {
        Http::fake([
            'example.com/*' => Http::response('server error', 500),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhooks',
            'secret' => 'a-very-secret-value',
            'events' => ['invoice.paid'],
            'active' => true,
        ]);

        $delivery = $webhook->deliveries()->create([
            'event' => 'invoice.paid',
            'payload' => ['invoice_id' => 123],
            'attempts' => 0,
        ]);

        $shouldRetry = (new WebhookDispatcher)->attemptDelivery($delivery);

        $this->assertTrue($shouldRetry);
        $this->assertSame(1, $delivery->refresh()->attempts);
        $this->assertSame(500, $delivery->response_code);
        $this->assertNull($delivery->delivered_at);
        $this->assertNotNull($delivery->next_retry_at);
    }
}
