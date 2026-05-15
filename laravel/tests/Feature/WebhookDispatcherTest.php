<?php

namespace Tests\Feature;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class WebhookDispatcherTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_dispatch_creates_delivery_records_and_queues_matching_active_webhooks(): void
    {
        Queue::fake();

        $matchingWebhook = Webhook::query()->create([
            'url' => 'https://example.com/webhooks/matching',
            'secret' => 'matching-secret-value',
            'events' => ['invoice.created'],
            'active' => true,
        ]);
        Webhook::query()->create([
            'url' => 'https://example.com/webhooks/inactive',
            'secret' => 'inactive-secret-value',
            'events' => ['invoice.created'],
            'active' => false,
        ]);
        Webhook::query()->create([
            'url' => 'https://example.com/webhooks/other-event',
            'secret' => 'other-event-secret',
            'events' => ['invoice.paid'],
            'active' => true,
        ]);

        $deliveries = (new WebhookDispatcher)->dispatch('invoice.created', ['invoice_id' => 123]);

        $this->assertCount(1, $deliveries);
        $this->assertDatabaseHas('webhook_deliveries', [
            'webhook_id' => $matchingWebhook->id,
            'event' => 'invoice.created',
            'attempts' => 0,
        ]);

        Queue::assertPushed(
            DispatchWebhookJob::class,
            fn (DispatchWebhookJob $job): bool => $job->deliveryId === $deliveries->first()->id
        );
    }

    public function test_send_posts_signed_json_and_records_successful_delivery(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-16 12:00:00'));
        Http::fake([
            'https://example.com/webhooks/success' => Http::response(['ok' => true], 204),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhooks/success',
            'secret' => 'success-secret-value',
            'events' => ['invoice.paid'],
            'active' => true,
        ]);
        $delivery = $webhook->deliveries()->create([
            'event' => 'invoice.paid',
            'payload' => ['invoice_id' => 456],
            'attempts' => 0,
        ]);

        $dispatcher = new WebhookDispatcher;
        $updatedDelivery = $dispatcher->send($delivery);

        $expectedPayload = $dispatcher->encodePayload(['invoice_id' => 456]);
        $expectedSignature = $dispatcher->generateSignature('success-secret-value', $expectedPayload);

        Http::assertSent(fn ($request): bool => $request->url() === 'https://example.com/webhooks/success'
            && $request->body() === $expectedPayload
            && $request->hasHeader('X-Webhook-Event', 'invoice.paid')
            && $request->hasHeader('X-Webhook-Signature', $expectedSignature));

        $this->assertSame(1, $updatedDelivery->attempts);
        $this->assertSame(204, $updatedDelivery->response_code);
        $this->assertNull($updatedDelivery->next_retry_at);
        $this->assertTrue($updatedDelivery->delivered_at->equalTo(CarbonImmutable::now()));
    }

    public function test_send_records_failed_delivery_and_next_retry_time(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-16 12:00:00'));
        Http::fake([
            'https://example.com/webhooks/fail' => Http::response(['error' => true], 500),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhooks/fail',
            'secret' => 'failure-secret-value',
            'events' => ['invoice.failed'],
            'active' => true,
        ]);
        $delivery = $webhook->deliveries()->create([
            'event' => 'invoice.failed',
            'payload' => ['invoice_id' => 789],
            'attempts' => 0,
        ]);

        $updatedDelivery = (new WebhookDispatcher)->send($delivery);

        $this->assertSame(1, $updatedDelivery->attempts);
        $this->assertSame(500, $updatedDelivery->response_code);
        $this->assertTrue(
            CarbonImmutable::parse('2026-05-16 12:00:02')->equalTo($updatedDelivery->next_retry_at)
        );
        $this->assertNull($updatedDelivery->delivered_at);
    }

    public function test_failed_final_attempt_does_not_schedule_another_retry(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-16 12:00:00'));
        Http::fake([
            'https://example.com/webhooks/final-fail' => Http::response([], 503),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhooks/final-fail',
            'secret' => 'final-failure-secret-value',
            'events' => ['invoice.failed'],
            'active' => true,
        ]);
        $delivery = $webhook->deliveries()->create([
            'event' => 'invoice.failed',
            'payload' => ['invoice_id' => 999],
            'attempts' => WebhookDispatcher::MAX_ATTEMPTS - 1,
        ]);

        $updatedDelivery = (new WebhookDispatcher)->send($delivery);

        $this->assertSame(WebhookDispatcher::MAX_ATTEMPTS, $updatedDelivery->attempts);
        $this->assertSame(503, $updatedDelivery->response_code);
        $this->assertNull($updatedDelivery->next_retry_at);
        $this->assertNull($updatedDelivery->delivered_at);
    }
}
