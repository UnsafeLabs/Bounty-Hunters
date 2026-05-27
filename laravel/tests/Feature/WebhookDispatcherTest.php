<?php

namespace Tests\Feature;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

class WebhookDispatcherTest extends TestCase
{
    use RefreshDatabase;

    public function test_dispatch_creates_delivery_only_for_matching_active_webhooks(): void
    {
        Queue::fake();

        $matching = Webhook::query()->create([
            'url' => 'https://example.com/matching',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.created'],
            'active' => true,
        ]);

        Webhook::query()->create([
            'url' => 'https://example.com/inactive',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.created'],
            'active' => false,
        ]);

        Webhook::query()->create([
            'url' => 'https://example.com/other-event',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.cancelled'],
            'active' => true,
        ]);

        $deliveries = app(WebhookDispatcher::class)->dispatch('order.created', [
            'order_id' => 123,
        ]);

        $this->assertCount(1, $deliveries);
        $this->assertSame($matching->id, $deliveries[0]->webhook_id);

        Queue::assertPushed(DispatchWebhookJob::class, fn (DispatchWebhookJob $job): bool => $job->deliveryId === $deliveries[0]->id);
    }

    public function test_deliver_sends_signed_json_and_marks_success(): void
    {
        Http::fake([
            'example.com/*' => Http::response(['ok' => true], 202),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhook',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.created'],
            'active' => true,
        ]);

        $delivery = WebhookDelivery::query()->create([
            'webhook_id' => $webhook->id,
            'event' => 'order.created',
            'payload' => ['order_id' => 123, 'total' => '49.00'],
        ]);

        $dispatcher = app(WebhookDispatcher::class);

        $this->assertTrue($dispatcher->deliver($delivery));

        Http::assertSent(function ($request) use ($dispatcher, $webhook): bool {
            $body = $request->body();

            return $request->url() === 'https://example.com/webhook'
                && $request->method() === 'POST'
                && $request->header('X-Webhook-Event')[0] === 'order.created'
                && $request->header('X-Webhook-Signature')[0] === $dispatcher->signature($body, $webhook->secret);
        });

        $delivery->refresh();

        $this->assertSame(1, $delivery->attempts);
        $this->assertSame(202, $delivery->response_code);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNull($delivery->next_retry_at);
    }

    public function test_failed_delivery_records_attempt_and_job_retries(): void
    {
        Http::fake([
            'example.com/*' => Http::response(['error' => true], 500),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhook',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.created'],
            'active' => true,
        ]);

        $delivery = WebhookDelivery::query()->create([
            'webhook_id' => $webhook->id,
            'event' => 'order.created',
            'payload' => ['order_id' => 123],
        ]);

        try {
            (new DispatchWebhookJob($delivery->id))->handle(app(WebhookDispatcher::class));
            $this->fail('Expected failed webhook delivery to trigger a retry exception.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('failed', $exception->getMessage());
        }

        $delivery->refresh();

        $this->assertSame(1, $delivery->attempts);
        $this->assertSame(500, $delivery->response_code);
        $this->assertNull($delivery->delivered_at);
        $this->assertNotNull($delivery->next_retry_at);
    }
}
