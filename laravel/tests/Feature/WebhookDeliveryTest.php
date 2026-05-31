<?php

namespace Tests\Feature;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

class WebhookDeliveryTest extends TestCase
{
    use RefreshDatabase;

    public function test_dispatch_event_creates_deliveries_for_active_matching_webhooks(): void
    {
        Queue::fake();

        $matchingWebhook = Webhook::query()->create([
            'url' => 'https://example.test/user',
            'secret' => 'secret',
            'events' => ['user.created'],
        ]);

        Webhook::query()->create([
            'url' => 'https://example.test/inactive',
            'secret' => 'secret',
            'events' => ['user.created'],
            'active' => false,
        ]);

        Webhook::query()->create([
            'url' => 'https://example.test/other',
            'secret' => 'secret',
            'events' => ['invoice.paid'],
        ]);

        $deliveries = app(WebhookDispatcher::class)->dispatchEvent('user.created', ['id' => 1]);

        $this->assertCount(1, $deliveries);
        $this->assertDatabaseHas('webhook_deliveries', [
            'webhook_id' => $matchingWebhook->id,
            'event' => 'user.created',
            'attempts' => 0,
        ]);
        Queue::assertPushed(DispatchWebhookJob::class, 1);
    }

    public function test_successful_delivery_posts_signed_json_and_stores_history(): void
    {
        Http::fake([
            'https://example.test/webhook' => Http::response(['ok' => true], 202),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.test/webhook',
            'secret' => 'secret',
            'events' => ['user.created'],
        ]);
        $delivery = $webhook->deliveries()->create([
            'event' => 'user.created',
            'payload' => ['id' => 1],
        ]);

        app(WebhookDispatcher::class)->send($delivery);

        $delivery->refresh();

        $this->assertSame(1, $delivery->attempts);
        $this->assertSame(202, $delivery->response_code);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNull($delivery->next_retry_at);

        Http::assertSent(function ($request) use ($webhook): bool {
            $body = [
                'event' => 'user.created',
                'payload' => ['id' => 1],
            ];
            $expectedSignature = app(WebhookDispatcher::class)->signature($webhook, $body);

            return $request->url() === 'https://example.test/webhook'
                && $request->method() === 'POST'
                && $request->header('X-Webhook-Event')[0] === 'user.created'
                && $request->header('X-Webhook-Signature')[0] === $expectedSignature
                && $request->data() === $body;
        });
    }

    public function test_failed_delivery_stores_response_and_next_retry_time(): void
    {
        Http::fake([
            'https://example.test/webhook' => Http::response(['error' => true], 503),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.test/webhook',
            'secret' => 'secret',
            'events' => ['user.created'],
        ]);
        $delivery = $webhook->deliveries()->create([
            'event' => 'user.created',
            'payload' => ['id' => 1],
        ]);

        $this->expectException(RuntimeException::class);

        try {
            app(WebhookDispatcher::class)->send($delivery);
        } finally {
            $delivery->refresh();

            $this->assertSame(1, $delivery->attempts);
            $this->assertSame(503, $delivery->response_code);
            $this->assertNull($delivery->delivered_at);
            $this->assertNotNull($delivery->next_retry_at);
        }
    }
}
